package database

import (
	"context"
	"strings"
	"testing"
)

func TestOpenRedisRejectsInvalidURL(t *testing.T) {
	_, err := OpenRedis(context.Background(), RedisConfig{URL: "://invalid"})
	if err == nil {
		t.Fatal("OpenRedis() error = nil, want non-nil")
	}
	if !strings.Contains(err.Error(), "解析 Redis URL") {
		t.Fatalf("OpenRedis() error = %q", err)
	}
}
