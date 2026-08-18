package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/devseed"
)

const seedTimeout = 30 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("本地开发项目 seed 失败", "error", err)
		os.Exit(1)
	}
}

func run() error {
	postgresDSN := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if postgresDSN == "" {
		return fmt.Errorf("DATABASE_URL 不能为空")
	}

	project := devseed.Project{
		ID:        valueOrDefault("DEV_PROJECT_ID", devseed.DefaultProjectID),
		Name:      valueOrDefault("DEV_PROJECT_NAME", devseed.DefaultProjectName),
		PublicKey: valueOrDefault("DEV_PROJECT_PUBLIC_KEY", devseed.DefaultPublicKey),
	}

	ctx, cancel := context.WithTimeout(context.Background(), seedTimeout)
	defer cancel()

	postgresDB, err := database.OpenPostgreSQL(
		ctx,
		database.PostgreSQLConfig{DSN: postgresDSN},
	)
	if err != nil {
		return err
	}
	postgresPool, err := postgresDB.DB()
	if err != nil {
		return fmt.Errorf("获取 PostgreSQL 连接池: %w", err)
	}
	defer postgresPool.Close()

	if err := devseed.UpsertProject(ctx, postgresDB, project); err != nil {
		return err
	}

	slog.Info(
		"本地开发项目已就绪",
		"projectId", project.ID,
		"projectName", project.Name,
		"publicKey", project.PublicKey,
	)

	return nil
}

func valueOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	return value
}
