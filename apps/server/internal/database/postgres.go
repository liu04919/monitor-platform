// database 包负责创建并配置基础数据库连接。
package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	defaultMaxOpenConnections = 10
	defaultMaxIdleConnections = 5
	defaultConnectionLifetime = 30 * time.Minute
)

// PostgreSQLConfig 描述 PostgreSQL 连接和连接池参数。
type PostgreSQLConfig struct {
	DSN                string
	MaxOpenConnections int
	MaxIdleConnections int
	ConnectionLifetime time.Duration
}

// OpenPostgreSQL 创建 GORM 数据库对象，并在返回前确认数据库可以连接。
// GORM 底层仍然使用 database/sql，因此连接池参数最终配置在 sql.DB 上。
func OpenPostgreSQL(ctx context.Context, cfg PostgreSQLConfig) (*gorm.DB, error) {
	if strings.TrimSpace(cfg.DSN) == "" {
		return nil, fmt.Errorf("PostgreSQL DSN 不能为空")
	}

	db, err := gorm.Open(postgres.Open(cfg.DSN), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("打开 PostgreSQL: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("获取 PostgreSQL 连接池: %w", err)
	}

	maxOpenConnections := cfg.MaxOpenConnections
	if maxOpenConnections <= 0 {
		maxOpenConnections = defaultMaxOpenConnections
	}

	maxIdleConnections := cfg.MaxIdleConnections
	if maxIdleConnections <= 0 {
		maxIdleConnections = defaultMaxIdleConnections
	}

	connectionLifetime := cfg.ConnectionLifetime
	if connectionLifetime <= 0 {
		connectionLifetime = defaultConnectionLifetime
	}

	sqlDB.SetMaxOpenConns(maxOpenConnections)
	sqlDB.SetMaxIdleConns(maxIdleConnections)
	sqlDB.SetConnMaxLifetime(connectionLifetime)

	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()

		return nil, fmt.Errorf("连接 PostgreSQL: %w", err)
	}

	return db, nil
}
