//go:build integration

package redis

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	redisclient "github.com/redis/go-redis/v9"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

func TestSessionStoreWithRedis(t *testing.T) {
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("未设置 TEST_REDIS_URL，跳过 Redis Session 集成测试")
	}

	options, err := redisclient.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("解析 Redis URL 失败: %v", err)
	}
	client := redisclient.NewClient(options)
	t.Cleanup(func() { _ = client.Close() })

	ctx := context.Background()
	token := fmt.Sprintf("integration-session-%d", time.Now().UnixNano())
	store := NewSessionStore(client)
	t.Cleanup(func() { _ = client.Del(context.Background(), sessionKey(token)).Err() })

	if err := store.Create(ctx, token, "user-1", 5*time.Minute); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if exists, err := client.Exists(ctx, token).Result(); err != nil || exists != 0 {
		t.Fatalf("raw token key exists = %d, error = %v", exists, err)
	}
	ttl, err := client.TTL(ctx, sessionKey(token)).Result()
	if err != nil || ttl <= 0 || ttl > 5*time.Minute {
		t.Fatalf("session TTL = %s, error = %v", ttl, err)
	}

	userID, err := store.FindUserID(ctx, token)
	if err != nil || userID != "user-1" {
		t.Fatalf("FindUserID() = %q, %v", userID, err)
	}
	if err := store.Delete(ctx, token); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	_, err = store.FindUserID(ctx, token)
	if !errors.Is(err, auth.ErrSessionNotFound) {
		t.Fatalf("FindUserID() after delete error = %v", err)
	}
}
