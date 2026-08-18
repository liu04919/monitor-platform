// app 包是服务端的应用组装层，负责创建业务依赖并管理数据库资源。
package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/liu04919/monitor-platform/apps/server/internal/config"
	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/handler"
	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
	"github.com/liu04919/monitor-platform/apps/server/internal/router"
	clickhousestore "github.com/liu04919/monitor-platform/apps/server/internal/storage/clickhouse"
	postgresstore "github.com/liu04919/monitor-platform/apps/server/internal/storage/postgres"
)

// App 持有已经组装完成的 HTTP Handler 和由应用负责关闭的数据库连接。
type App struct {
	Handler http.Handler

	postgresPool   *sql.DB
	clickHouseConn driver.Conn
	closeOnce      sync.Once
	closeErr       error
}

// New 创建数据库连接，并把接入校验、批次存储和 HTTP 路由组装成完整应用。
func New(ctx context.Context, cfg config.Config) (*App, error) {
	postgresDB, err := database.OpenPostgreSQL(
		ctx,
		database.PostgreSQLConfig{DSN: cfg.DatabaseURL},
	)
	if err != nil {
		return nil, fmt.Errorf("创建 PostgreSQL 连接: %w", err)
	}

	postgresPool, err := postgresDB.DB()
	if err != nil {
		return nil, fmt.Errorf("获取 PostgreSQL 连接池: %w", err)
	}

	clickHouseConn, err := database.OpenClickHouse(
		ctx,
		database.ClickHouseConfig{DSN: cfg.ClickHouseDSN},
	)
	if err != nil {
		return nil, errors.Join(
			fmt.Errorf("创建 ClickHouse 连接: %w", err),
			closePostgreSQL(postgresPool),
		)
	}

	keyVerifier := postgresstore.NewProjectKeyVerifier(postgresDB)
	batchReceipts := postgresstore.NewBatchReceiptStore(postgresDB)
	eventWriter := clickhousestore.NewEventWriter(clickHouseConn)
	batchStore := ingestion.NewBatchStore(batchReceipts, eventWriter)
	ingestor := ingestion.NewService(keyVerifier, batchStore)
	telemetryHandler := handler.NewTelemetryHandler(ingestor)

	return &App{
		Handler:        router.New(telemetryHandler),
		postgresPool:   postgresPool,
		clickHouseConn: clickHouseConn,
	}, nil
}

// Close 关闭应用持有的数据库资源。HTTP Server 必须在调用它之前停止。
func (a *App) Close() error {
	a.closeOnce.Do(func() {
		a.closeErr = errors.Join(
			closeClickHouse(a.clickHouseConn),
			closePostgreSQL(a.postgresPool),
		)
	})

	return a.closeErr
}

func closeClickHouse(conn driver.Conn) error {
	if conn == nil {
		return nil
	}
	if err := conn.Close(); err != nil {
		return fmt.Errorf("关闭 ClickHouse: %w", err)
	}

	return nil
}

func closePostgreSQL(pool *sql.DB) error {
	if pool == nil {
		return nil
	}
	if err := pool.Close(); err != nil {
		return fmt.Errorf("关闭 PostgreSQL: %w", err)
	}

	return nil
}
