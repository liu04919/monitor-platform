package database

import (
	"context"
	"fmt"

	redisclient "github.com/redis/go-redis/v9"
)

type RedisConfig struct {
	URL string
}

// OpenRedis 创建 Redis 客户端并主动 Ping，避免应用带着不可用的 Session 存储启动。
func OpenRedis(ctx context.Context, cfg RedisConfig) (*redisclient.Client, error) {
	options, err := redisclient.ParseURL(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("解析 Redis URL: %w", err)
	}

	client := redisclient.NewClient(options)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("连接 Redis: %w", err)
	}

	return client, nil
}
