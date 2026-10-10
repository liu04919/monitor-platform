package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/liu04919/monitor-platform/apps/server/internal/config"
	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
	kafkaqueue "github.com/liu04919/monitor-platform/apps/server/internal/queue/kafka"
	clickhousestore "github.com/liu04919/monitor-platform/apps/server/internal/storage/clickhouse"
	postgresstore "github.com/liu04919/monitor-platform/apps/server/internal/storage/postgres"
)

// Worker 作为独立进程消费 Kafka；无需启动 HTTP 路由或连接 Redis。
type Worker struct {
	consumer       *kafkaqueue.Consumer
	postgresPool   *sql.DB
	clickHouseConn driver.Conn
	closeOnce      sync.Once
	closeErr       error
}

func NewWorker(ctx context.Context, cfg config.Config) (*Worker, error) {
	db, err := database.OpenPostgreSQL(ctx, database.PostgreSQLConfig{DSN: cfg.DatabaseURL})
	if err != nil {
		return nil, fmt.Errorf("创建消费者 PostgreSQL 连接: %w", err)
	}
	pool, err := db.DB()
	if err != nil {
		return nil, err
	}
	conn, err := database.OpenClickHouse(ctx, database.ClickHouseConfig{DSN: cfg.ClickHouseDSN})
	if err != nil {
		return nil, errors.Join(err, closePostgreSQL(pool))
	}
	store := ingestion.NewBatchStore(
		postgresstore.NewBatchReceiptStore(db),
		clickhousestore.NewEventWriter(conn),
	)
	return &Worker{
		consumer:     kafkaqueue.NewConsumer(cfg.KafkaBrokers, cfg.KafkaTopic, cfg.KafkaConsumerGroup, store),
		postgresPool: pool, clickHouseConn: conn,
	}, nil
}

func (w *Worker) Run(ctx context.Context) error { return w.consumer.Run(ctx) }

// Close 在 Run 退出后调用；未提交的消息留给下次消费。
func (w *Worker) Close() error {
	w.closeOnce.Do(func() {
		w.closeErr = errors.Join(w.consumer.Close(), closeClickHouse(w.clickHouseConn), closePostgreSQL(w.postgresPool))
	})
	return w.closeErr
}
