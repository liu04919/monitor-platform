package config

import (
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	t.Setenv("APP_ENV", " production ")
	t.Setenv("HTTP_ADDR", "127.0.0.1:9090")
	t.Setenv("DATABASE_URL", " postgres://monitor:password@localhost:5432/monitor_platform ")
	t.Setenv("CLICKHOUSE_DSN", " clickhouse://monitor:password@localhost:9000/monitor_platform ")

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
}

func TestLoadUsesHTTPDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("DATABASE_URL", "postgres://monitor:password@localhost:5432/monitor_platform")
	t.Setenv("CLICKHOUSE_DSN", "clickhouse://monitor:password@localhost:9000/monitor_platform")

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
}

func TestLoadRejectsInvalidOrMissingValues(t *testing.T) {
	tests := []struct {
		name          string
		httpAddress   string
		databaseURL   string
		clickHouseDSN string
		wantErrorPart string
	}{
		{
			name:          "invalid HTTP address",
			httpAddress:   "8080",
			databaseURL:   "postgres://database",
			clickHouseDSN: "clickhouse://database",
			wantErrorPart: "HTTP_ADDR",
		},
		{
			name:          "missing PostgreSQL DSN",
			httpAddress:   ":8080",
			clickHouseDSN: "clickhouse://database",
			wantErrorPart: "DATABASE_URL",
		},
		{
			name:          "missing ClickHouse DSN",
			httpAddress:   ":8080",
			databaseURL:   "postgres://database",
			wantErrorPart: "CLICKHOUSE_DSN",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("HTTP_ADDR", test.httpAddress)
			t.Setenv("DATABASE_URL", test.databaseURL)
			t.Setenv("CLICKHOUSE_DSN", test.clickHouseDSN)

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
