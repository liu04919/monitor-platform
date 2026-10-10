package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/liu04919/monitor-platform/apps/server/internal/app"
	"github.com/liu04919/monitor-platform/apps/server/internal/config"
)

func main() {
	if err := run(); err != nil {
		slog.Error("Kafka 消费者停止", "error", err)
		os.Exit(1)
	}
}

func run() (runErr error) {
	if err := config.LoadDotEnv(); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	worker, err := app.NewWorker(ctx, cfg)
	if err != nil {
		return fmt.Errorf("创建 Kafka 消费者: %w", err)
	}
	defer func() { runErr = errors.Join(runErr, worker.Close()) }()
	slog.Info("Kafka 消费者启动", "topic", cfg.KafkaTopic, "group", cfg.KafkaConsumerGroup)
	if err := worker.Run(ctx); err != nil {
		return err
	}
	slog.Info("Kafka 消费者已停止")
	return nil
}
