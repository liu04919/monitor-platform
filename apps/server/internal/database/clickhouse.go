package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	clickhouseclient "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

const (
	defaultClickHouseMaxOpenConnections = 10
	defaultClickHouseMaxIdleConnections = 5
	defaultClickHouseConnectionLifetime = 30 * time.Minute
	defaultClickHouseDialTimeout        = 5 * time.Second
)

// ClickHouseConfig 描述 ClickHouse 连接和连接池参数。
type ClickHouseConfig struct {
	DSN                string
	MaxOpenConnections int
	MaxIdleConnections int
	ConnectionLifetime time.Duration
	DialTimeout        time.Duration
}

// OpenClickHouse 创建官方 ClickHouse 客户端，并在返回前确认数据库可以连接。
func OpenClickHouse(ctx context.Context, cfg ClickHouseConfig) (driver.Conn, error) {
	if strings.TrimSpace(cfg.DSN) == "" {
		return nil, fmt.Errorf("ClickHouse DSN 不能为空")
	}

	options, err := clickhouseclient.ParseDSN(cfg.DSN)
	if err != nil {
		return nil, fmt.Errorf("解析 ClickHouse DSN: %w", err)
	}

	options.MaxOpenConns = valueOrDefault(cfg.MaxOpenConnections, defaultClickHouseMaxOpenConnections)
	options.MaxIdleConns = valueOrDefault(cfg.MaxIdleConnections, defaultClickHouseMaxIdleConnections)
	options.ConnMaxLifetime = durationOrDefault(cfg.ConnectionLifetime, defaultClickHouseConnectionLifetime)
	options.DialTimeout = durationOrDefault(cfg.DialTimeout, defaultClickHouseDialTimeout)

	conn, err := clickhouseclient.Open(options)
	if err != nil {
		return nil, fmt.Errorf("打开 ClickHouse: %w", err)
	}

	if err := conn.Ping(ctx); err != nil {
		_ = conn.Close()

		return nil, fmt.Errorf("连接 ClickHouse: %w", err)
	}

	return conn, nil
}

func valueOrDefault(value, fallback int) int {
	if value <= 0 {
		return fallback
	}

	return value
}

func durationOrDefault(value, fallback time.Duration) time.Duration {
	if value <= 0 {
		return fallback
	}

	return value
}
