package config

import (
	"fmt"
	"net"
	"os"
	"strings"
)

const (
	defaultEnvironment = "development"
	defaultHTTPAddress = ":8080"
)

type Config struct {
	Environment string
	HTTPAddress string
}

func Load() (Config, error) {
	cfg := Config{
		Environment: valueOrDefault("APP_ENV", defaultEnvironment),
		HTTPAddress: valueOrDefault("HTTP_ADDR", defaultHTTPAddress),
	}

	if _, _, err := net.SplitHostPort(cfg.HTTPAddress); err != nil {
		return Config{}, fmt.Errorf("invalid HTTP_ADDR %q: %w", cfg.HTTPAddress, err)
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
