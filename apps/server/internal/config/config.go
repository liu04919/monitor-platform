package config

import (
	"fmt"
	"net"
	"os"
	"strings"
)

const (
	defaultEnvironment       = "development"
	defaultHTTPAddress       = ":8080"
	minManagementTokenLength = 32
)

type Config struct {
	Environment        string
	HTTPAddress        string
	DatabaseURL        string
	ClickHouseDSN      string
	ManagementAPIToken string
}

func Load() (Config, error) {
	cfg := Config{
		Environment:        valueOrDefault("APP_ENV", defaultEnvironment),
		HTTPAddress:        valueOrDefault("HTTP_ADDR", defaultHTTPAddress),
		DatabaseURL:        strings.TrimSpace(os.Getenv("DATABASE_URL")),
		ClickHouseDSN:      strings.TrimSpace(os.Getenv("CLICKHOUSE_DSN")),
		ManagementAPIToken: strings.TrimSpace(os.Getenv("MANAGEMENT_API_TOKEN")),
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
	if len(cfg.ManagementAPIToken) < minManagementTokenLength {
		return Config{}, fmt.Errorf(
			"MANAGEMENT_API_TOKEN must contain at least %d bytes",
			minManagementTokenLength,
		)
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
