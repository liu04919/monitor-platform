package config

import (
	"fmt"
	"net"
	"os"
	"strings"
	"time"
)

const (
	defaultEnvironment = "development"
	defaultHTTPAddress = ":8080"
	defaultSessionTTL  = 7 * 24 * time.Hour
)

type Config struct {
	Environment         string
	HTTPAddress         string
	DatabaseURL         string
	ClickHouseDSN       string
	RedisURL            string
	SessionTTL          time.Duration
	SessionCookieSecure bool
}

func Load() (Config, error) {
	environment := valueOrDefault("APP_ENV", defaultEnvironment)
	cfg := Config{
		Environment:         environment,
		HTTPAddress:         valueOrDefault("HTTP_ADDR", defaultHTTPAddress),
		DatabaseURL:         strings.TrimSpace(os.Getenv("DATABASE_URL")),
		ClickHouseDSN:       strings.TrimSpace(os.Getenv("CLICKHOUSE_DSN")),
		RedisURL:            strings.TrimSpace(os.Getenv("REDIS_URL")),
		SessionTTL:          defaultSessionTTL,
		SessionCookieSecure: environment == "production",
	}

	if rawSessionTTL := strings.TrimSpace(os.Getenv("SESSION_TTL")); rawSessionTTL != "" {
		sessionTTL, err := time.ParseDuration(rawSessionTTL)
		if err != nil || sessionTTL <= 0 {
			return Config{}, fmt.Errorf("SESSION_TTL must be a positive Go duration")
		}
		cfg.SessionTTL = sessionTTL
	}

	if _, _, err := net.SplitHostPort(cfg.HTTPAddress); err != nil {
		return Config{}, fmt.Errorf("invalid HTTP_ADDR %q: %w", cfg.HTTPAddress, err)
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.ClickHouseDSN == "" {
		return Config{}, fmt.Errorf("CLICKHOUSE_DSN is required")
	}
	if cfg.RedisURL == "" {
		return Config{}, fmt.Errorf("REDIS_URL is required")
	}
	return cfg, nil
}

func valueOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	return value
}
