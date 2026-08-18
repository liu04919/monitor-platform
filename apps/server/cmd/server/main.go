package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/app"
	"github.com/liu04919/monitor-platform/apps/server/internal/config"
)

const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 15 * time.Second
	writeTimeout      = 15 * time.Second
	idleTimeout       = 60 * time.Second
	shutdownTimeout   = 10 * time.Second
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped with an error", "error", err)
		os.Exit(1)
	}
}

func run() (runErr error) {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	application, err := app.New(ctx, cfg)
	if err != nil {
		return fmt.Errorf("create application: %w", err)
	}
	defer func() {
		if err := application.Close(); err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("close application: %w", err))
		}
	}()

	server := &http.Server{
		Addr:              cfg.HTTPAddress,
		Handler:           application.Handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	serverErr := make(chan error, 1)

	go func() {
		slog.Info(
			"HTTP server starting",
			"address", cfg.HTTPAddress,
			"environment", cfg.Environment,
		)

		serverErr <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}

		return fmt.Errorf("serve HTTP: %w", err)
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		shutdownErr := fmt.Errorf("shutdown HTTP server: %w", err)
		if closeErr := server.Close(); closeErr != nil {
			shutdownErr = errors.Join(
				shutdownErr,
				fmt.Errorf("force close HTTP server: %w", closeErr),
			)
		}

		return shutdownErr
	}

	if err := <-serverErr; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve HTTP after shutdown: %w", err)
	}

	slog.Info("HTTP server stopped")

	return nil
}
