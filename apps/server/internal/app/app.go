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
	redisclient "github.com/redis/go-redis/v9"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
	"github.com/liu04919/monitor-platform/apps/server/internal/config"
	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/eventquery"
	"github.com/liu04919/monitor-platform/apps/server/internal/handler"
	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
	"github.com/liu04919/monitor-platform/apps/server/internal/project"
	"github.com/liu04919/monitor-platform/apps/server/internal/router"
	clickhousestore "github.com/liu04919/monitor-platform/apps/server/internal/storage/clickhouse"
	postgresstore "github.com/liu04919/monitor-platform/apps/server/internal/storage/postgres"
	redisstore "github.com/liu04919/monitor-platform/apps/server/internal/storage/redis"
)

// App 持有已经组装完成的 HTTP Handler 和由应用负责关闭的数据库连接。
type App struct {
	Handler http.Handler

	postgresPool   *sql.DB
	clickHouseConn driver.Conn
	redisClient    *redisclient.Client
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

	redisClient, err := database.OpenRedis(ctx, database.RedisConfig{URL: cfg.RedisURL})
	if err != nil {
		return nil, errors.Join(
			fmt.Errorf("创建 Redis 连接: %w", err),
			closeClickHouse(clickHouseConn),
			closePostgreSQL(postgresPool),
		)
	}

	keyVerifier := postgresstore.NewProjectKeyVerifier(postgresDB)         // PostgreSQL 存储：校验项目 publicKey
	batchReceipts := postgresstore.NewBatchReceiptStore(postgresDB)        // PostgreSQL 存储：记录接入批次状态
	eventWriter := clickhousestore.NewEventWriter(clickHouseConn)          // ClickHouse 存储：写入遥测事件
	eventReader := clickhousestore.NewEventReader(clickHouseConn)          // ClickHouse 存储：查询遥测事件
	projectStore := postgresstore.NewProjectStore(postgresDB)              // PostgreSQL 存储：读写项目
	userStore := postgresstore.NewUserStore(postgresDB)                    // PostgreSQL 存储：读写用户
	sessionStore := redisstore.NewSessionStore(redisClient)                // Redis 存储：读写登录 Session
	batchStore := ingestion.NewBatchStore(batchReceipts, eventWriter)      // 接入业务：协调批次账本与事件写入
	ingestor := ingestion.NewService(keyVerifier, batchStore)              // 接入业务：校验并接收 SDK 上报
	telemetryHandler := handler.NewTelemetryHandler(ingestor)              // HTTP Handler：SDK 批量上报接口
	projectService := project.NewService(projectStore)                     // 项目业务：项目查询与创建
	projectHandler := handler.NewProjectHandler(projectService)            // HTTP Handler：项目查询与创建接口
	eventListService := eventquery.NewService(eventReader, projectService) // 事件查询业务：项目授权、列表与详情查询
	eventListHandler := handler.NewEventListHandler(eventListService)      // HTTP Handler：事件列表与详情接口
	authService := auth.NewService(
		userStore,
		sessionStore,
		auth.Argon2IDPasswordHasher{},
		auth.SecureTokenGenerator{},
		cfg.SessionTTL,
	) // 认证业务：注册、登录与 Session 生命周期
	authHandler := handler.NewAuthHandler(
		authService,
		cfg.SessionTTL,
		cfg.SessionCookieSecure,
	) // HTTP Handler：认证接口与 Session Cookie

	return &App{
		Handler: router.New(
			telemetryHandler,
			projectHandler,
			eventListHandler,
			authHandler,
			authService,
		),
		postgresPool:   postgresPool,
		clickHouseConn: clickHouseConn,
		redisClient:    redisClient,
	}, nil
}

// Close 关闭应用持有的数据库资源。HTTP Server 必须在调用它之前停止。
func (a *App) Close() error {
	a.closeOnce.Do(func() {
		a.closeErr = errors.Join(
			closeRedis(a.redisClient),
			closeClickHouse(a.clickHouseConn),
			closePostgreSQL(a.postgresPool),
		)
	})

	return a.closeErr
}

func closeRedis(client *redisclient.Client) error {
	if client == nil {
		return nil
	}
	if err := client.Close(); err != nil {
		return fmt.Errorf("关闭 Redis: %w", err)
	}

	return nil
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
