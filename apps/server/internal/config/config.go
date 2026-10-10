package config

import (
	"fmt"
	"net"
	"os"
	"regexp"
	"strconv"
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
	KafkaBrokers        []string
	KafkaTopic          string
	KafkaConsumerGroup  string
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
		KafkaBrokers:        strings.Split(valueOrDefault("KAFKA_BROKERS", "localhost:9092"), ","),
		KafkaTopic:          valueOrDefault("KAFKA_TELEMETRY_TOPIC", "telemetry-batches"),
		KafkaConsumerGroup:  valueOrDefault("KAFKA_CONSUMER_GROUP", "telemetry-writer"),
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
	for index, broker := range cfg.KafkaBrokers {
		broker = strings.TrimSpace(broker)
		host, port, err := net.SplitHostPort(broker)
		portNumber, portErr := strconv.Atoi(port)
		if err != nil || host == "" || portErr != nil || portNumber < 1 || portNumber > 65535 {
			return Config{}, fmt.Errorf("invalid KAFKA_BROKERS address %q", broker)
		}
		cfg.KafkaBrokers[index] = broker
	}
	if len(cfg.KafkaTopic) > 249 || cfg.KafkaTopic == "." || cfg.KafkaTopic == ".." ||
		!regexp.MustCompile(`^[a-zA-Z0-9._-]+$`).MatchString(cfg.KafkaTopic) {
		return Config{}, fmt.Errorf("invalid KAFKA_TELEMETRY_TOPIC %q", cfg.KafkaTopic)
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
