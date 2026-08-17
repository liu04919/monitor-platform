package database

import (
	"context"
	"strings"
	"testing"
)

func TestOpenClickHouseRejectsEmptyDSN(t *testing.T) {
	t.Parallel()

	_, err := OpenClickHouse(context.Background(), ClickHouseConfig{})
	if err == nil {
		t.Fatal("OpenClickHouse() error = nil, want non-nil")
	}

	if !strings.Contains(err.Error(), "DSN") {
		t.Fatalf("OpenClickHouse() error = %q, want DSN message", err)
	}
}

func TestOpenClickHouseRejectsInvalidDSN(t *testing.T) {
	t.Parallel()

	_, err := OpenClickHouse(context.Background(), ClickHouseConfig{DSN: "://invalid"})
	if err == nil {
		t.Fatal("OpenClickHouse() error = nil, want non-nil")
	}

	if !strings.Contains(err.Error(), "解析 ClickHouse DSN") {
		t.Fatalf("OpenClickHouse() error = %q, want parse message", err)
	}
}
