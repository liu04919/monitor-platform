package database

import (
	"context"
	"strings"
	"testing"
)

func TestOpenPostgreSQLRejectsEmptyDSN(t *testing.T) {
	t.Parallel()

	_, err := OpenPostgreSQL(context.Background(), PostgreSQLConfig{})
	if err == nil {
		t.Fatal("OpenPostgreSQL() error = nil, want non-nil")
	}

	if !strings.Contains(err.Error(), "DSN") {
		t.Fatalf("OpenPostgreSQL() error = %q, want DSN message", err)
	}
}
