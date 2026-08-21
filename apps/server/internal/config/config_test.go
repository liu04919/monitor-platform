package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	t.Setenv("APP_ENV", " production ")
	t.Setenv("HTTP_ADDR", "127.0.0.1:9090")
	t.Setenv("DATABASE_URL", " postgres://monitor:password@localhost:5432/monitor_platform ")
	t.Setenv("CLICKHOUSE_DSN", " clickhouse://monitor:password@localhost:9000/monitor_platform ")
	t.Setenv("REDIS_URL", " redis://localhost:6379/0 ")
	t.Setenv("MANAGEMENT_API_TOKEN", " management-token-with-at-least-32-bytes ")
	t.Setenv("SESSION_TTL", "24h")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Environment != "production" {
		t.Fatalf("Environment = %q, want %q", cfg.Environment, "production")
	}
	if cfg.HTTPAddress != "127.0.0.1:9090" {
		t.Fatalf("HTTPAddress = %q, want %q", cfg.HTTPAddress, "127.0.0.1:9090")
	}
	if cfg.DatabaseURL != "postgres://monitor:password@localhost:5432/monitor_platform" {
		t.Fatalf("DatabaseURL 未去除首尾空白: %q", cfg.DatabaseURL)
	}
	if cfg.ClickHouseDSN != "clickhouse://monitor:password@localhost:9000/monitor_platform" {
		t.Fatalf("ClickHouseDSN 未去除首尾空白: %q", cfg.ClickHouseDSN)
	}
	if cfg.RedisURL != "redis://localhost:6379/0" {
		t.Fatalf("RedisURL 未去除首尾空白: %q", cfg.RedisURL)
	}
	if cfg.SessionTTL != 24*time.Hour {
		t.Fatalf("SessionTTL = %s, want %s", cfg.SessionTTL, 24*time.Hour)
	}
	if !cfg.SessionCookieSecure {
		t.Fatal("production SessionCookieSecure = false, want true")
	}
	if cfg.ManagementAPIToken != "management-token-with-at-least-32-bytes" {
		t.Fatalf("ManagementAPIToken 未去除首尾空白: %q", cfg.ManagementAPIToken)
	}
}

func TestLoadUsesHTTPDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("DATABASE_URL", "postgres://monitor:password@localhost:5432/monitor_platform")
	t.Setenv("CLICKHOUSE_DSN", "clickhouse://monitor:password@localhost:9000/monitor_platform")
	t.Setenv("REDIS_URL", "redis://localhost:6379/0")
	t.Setenv("MANAGEMENT_API_TOKEN", "management-token-with-at-least-32-bytes")
	t.Setenv("SESSION_TTL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Environment != defaultEnvironment {
		t.Fatalf("Environment = %q, want %q", cfg.Environment, defaultEnvironment)
	}
	if cfg.HTTPAddress != defaultHTTPAddress {
		t.Fatalf("HTTPAddress = %q, want %q", cfg.HTTPAddress, defaultHTTPAddress)
	}
	if cfg.SessionTTL != defaultSessionTTL {
		t.Fatalf("SessionTTL = %s, want %s", cfg.SessionTTL, defaultSessionTTL)
	}
	if cfg.SessionCookieSecure {
		t.Fatal("development SessionCookieSecure = true, want false")
	}
}

func TestLoadRejectsInvalidOrMissingValues(t *testing.T) {
	tests := []struct {
		name            string
		httpAddress     string
		databaseURL     string
		clickHouseDSN   string
		redisURL        string
		managementToken string
		sessionTTL      string
		wantErrorPart   string
	}{
		{
			name:            "invalid HTTP address",
			httpAddress:     "8080",
			databaseURL:     "postgres://database",
			clickHouseDSN:   "clickhouse://database",
			redisURL:        "redis://localhost:6379/0",
			managementToken: "management-token-with-at-least-32-bytes",
			wantErrorPart:   "HTTP_ADDR",
		},
		{
			name:            "missing PostgreSQL DSN",
			httpAddress:     ":8080",
			clickHouseDSN:   "clickhouse://database",
			redisURL:        "redis://localhost:6379/0",
			managementToken: "management-token-with-at-least-32-bytes",
			wantErrorPart:   "DATABASE_URL",
		},
		{
			name:            "missing ClickHouse DSN",
			httpAddress:     ":8080",
			databaseURL:     "postgres://database",
			managementToken: "management-token-with-at-least-32-bytes",
			redisURL:        "redis://localhost:6379/0",
			wantErrorPart:   "CLICKHOUSE_DSN",
		},
		{
			name:            "missing Redis URL",
			httpAddress:     ":8080",
			databaseURL:     "postgres://database",
			clickHouseDSN:   "clickhouse://database",
			managementToken: "management-token-with-at-least-32-bytes",
			wantErrorPart:   "REDIS_URL",
		},
		{
			name:          "missing management API token",
			httpAddress:   ":8080",
			databaseURL:   "postgres://database",
			clickHouseDSN: "clickhouse://database",
			redisURL:      "redis://localhost:6379/0",
			wantErrorPart: "MANAGEMENT_API_TOKEN",
		},
		{
			name:            "management API token too short",
			httpAddress:     ":8080",
			databaseURL:     "postgres://database",
			clickHouseDSN:   "clickhouse://database",
			redisURL:        "redis://localhost:6379/0",
			managementToken: "too-short",
			wantErrorPart:   "MANAGEMENT_API_TOKEN",
		},
		{
			name:            "invalid session TTL",
			httpAddress:     ":8080",
			databaseURL:     "postgres://database",
			clickHouseDSN:   "clickhouse://database",
			redisURL:        "redis://localhost:6379/0",
			managementToken: "management-token-with-at-least-32-bytes",
			sessionTTL:      "0s",
			wantErrorPart:   "SESSION_TTL",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("HTTP_ADDR", test.httpAddress)
			t.Setenv("DATABASE_URL", test.databaseURL)
			t.Setenv("CLICKHOUSE_DSN", test.clickHouseDSN)
			t.Setenv("REDIS_URL", test.redisURL)
			t.Setenv("MANAGEMENT_API_TOKEN", test.managementToken)
			t.Setenv("SESSION_TTL", test.sessionTTL)

			_, err := Load()
			if err == nil {
				t.Fatal("Load() error = nil, want non-nil")
			}
			if !strings.Contains(err.Error(), test.wantErrorPart) {
				t.Fatalf("Load() error = %q, want containing %q", err, test.wantErrorPart)
			}
		})
	}
}
