package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/migration"
)

const migrationTimeout = time.Minute

func main() {
	if err := run(); err != nil {
		slog.Error("数据库迁移失败", "error", err)
		os.Exit(1)
	}
}

func run() error {
	postgresDSN := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if postgresDSN == "" {
		return fmt.Errorf("DATABASE_URL 不能为空")
	}

	clickHouseDSN := strings.TrimSpace(os.Getenv("CLICKHOUSE_DSN"))
	if clickHouseDSN == "" {
		return fmt.Errorf("CLICKHOUSE_DSN 不能为空")
	}

	ctx, cancel := context.WithTimeout(context.Background(), migrationTimeout)
	defer cancel()

	postgresDB, err := database.OpenPostgreSQL(ctx, database.PostgreSQLConfig{DSN: postgresDSN})
	if err != nil {
		return err
	}
	postgresPool, err := postgresDB.DB()
	if err != nil {
		return fmt.Errorf("获取 PostgreSQL 连接池: %w", err)
	}
	defer postgresPool.Close()

	clickHouseConn, err := database.OpenClickHouse(ctx, database.ClickHouseConfig{DSN: clickHouseDSN})
	if err != nil {
		return err
	}
	defer clickHouseConn.Close()

	if err := migration.Up(ctx, postgresDB, clickHouseConn); err != nil {
		return err
	}

	slog.Info("数据库迁移完成")

	return nil
}
