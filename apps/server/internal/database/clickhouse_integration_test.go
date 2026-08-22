//go:build integration

package database

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestClickHouseTelemetryEventsTable(t *testing.T) {
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("未设置 TEST_CLICKHOUSE_DSN，跳过 ClickHouse 集成测试")
	}

	ctx := context.Background()
	conn, err := OpenClickHouse(ctx, ClickHouseConfig{DSN: dsn})
	if err != nil {
		t.Fatalf("连接测试数据库失败: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	var tableName string
	if err := conn.QueryRow(ctx, "SELECT name FROM system.tables WHERE database = currentDatabase() AND name = 'telemetry_events'").Scan(&tableName); err != nil {
		t.Fatalf("查询 telemetry_events 表失败: %v", err)
	}
	if tableName != "telemetry_events" {
		t.Fatalf("查询到的表名 = %q, want telemetry_events", tableName)
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	eventID := fmt.Sprintf("integration-event-%d", now.UnixNano())
	batchID := fmt.Sprintf("integration-batch-%d", now.UnixNano())

	batch, err := conn.PrepareBatch(ctx, `
		INSERT INTO telemetry_events
		(
			schema_version, project_id, app_name, batch_id, send_type, sent_at,
			event_id, category, event_type, event_timestamp, page_url,
			user_id, level, breadcrumbs_json, replay_data, payload_json, issue_fingerprint
		)
	`)
	if err != nil {
		t.Fatalf("准备测试事件批次失败: %v", err)
	}

	if err := batch.Append(
		uint16(2),
		"integration-project",
		"集成测试项目",
		batchID,
		"fetch",
		now,
		eventID,
		"error",
		"exception",
		now,
		"https://example.com/test",
		nil,
		"error",
		"[]",
		nil,
		`{"exception":{"name":"Error","message":"集成测试"}}`,
		"integration-fingerprint",
	); err != nil {
		t.Fatalf("追加测试事件失败: %v", err)
	}

	if err := batch.Send(); err != nil {
		t.Fatalf("写入测试事件失败: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := conn.Exec(cleanupCtx, "ALTER TABLE telemetry_events DELETE WHERE event_id = ? SETTINGS mutations_sync = 1", eventID); err != nil {
			t.Errorf("清理测试事件失败: %v", err)
		}
	})

	var (
		actualProjectID string
		actualCategory  string
		actualPayload   string
	)
	if err := conn.QueryRow(
		ctx,
		"SELECT project_id, category, payload_json FROM telemetry_events WHERE event_id = ?",
		eventID,
	).Scan(&actualProjectID, &actualCategory, &actualPayload); err != nil {
		t.Fatalf("查询测试事件失败: %v", err)
	}

	if actualProjectID != "integration-project" {
		t.Fatalf("project_id = %q, want integration-project", actualProjectID)
	}
	if actualCategory != "error" {
		t.Fatalf("category = %q, want error", actualCategory)
	}
	if !strings.Contains(actualPayload, "集成测试") {
		t.Fatalf("payload_json = %q, want integration test message", actualPayload)
	}
}
