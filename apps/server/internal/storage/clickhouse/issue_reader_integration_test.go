//go:build integration

package clickhouse_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/issuequery"
	clickhousestore "github.com/liu04919/monitor-platform/apps/server/internal/storage/clickhouse"
)

func TestIssueReaderAggregatesMatchingFingerprints(t *testing.T) {
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("未设置 TEST_CLICKHOUSE_DSN，跳过 IssueReader 集成测试")
	}

	ctx := context.Background()
	conn, err := database.OpenClickHouse(ctx, database.ClickHouseConfig{DSN: dsn})
	if err != nil {
		t.Fatalf("连接 ClickHouse 失败: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	projectID := uuid.NewString()
	now := time.Now().UTC().Truncate(time.Millisecond)
	payload := `{"exception":{"name":"TypeError","message":"profile failed","stack":[{"filename":"https://example.com/app.js","functionName":"renderProfile","line":42,"column":7}]}}`
	insertSQL := `
		INSERT INTO telemetry_events
		(
			schema_version, project_id, app_name, batch_id, send_type, sent_at,
			event_id, category, event_type, event_timestamp, page_url,
			user_id, level, breadcrumbs_json, replay_data, payload_json, issue_fingerprint
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	for index, userID := range []string{"user-1", "user-2"} {
		if err := conn.Exec(
			ctx,
			insertSQL,
			uint16(2), projectID, "IssueReader 测试", "batch-1", "fetch", now,
			"event-"+userID, "error", "js_error", now.Add(time.Duration(index)*time.Millisecond),
			"https://example.com/profile", userID, "error", "[]", nil, payload, "fingerprint-1",
		); err != nil {
			t.Fatalf("写入测试事件失败: %v", err)
		}
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := conn.Exec(
			cleanupCtx,
			"ALTER TABLE telemetry_events DELETE WHERE project_id = ? SETTINGS mutations_sync = 1",
			projectID,
		); err != nil {
			t.Errorf("清理测试事件失败: %v", err)
		}
	})

	reader := clickhousestore.NewIssueReader(conn)
	issues, err := reader.ListIssues(ctx, issuequery.ListFilter{
		ProjectID: projectID,
		Limit:     30,
	})
	if err != nil {
		t.Fatalf("ListIssues() error = %v", err)
	}

	for _, issue := range issues {
		if issue.EventType == "js_error" && issue.Title == "profile failed" {
			if issue.EventCount != 2 || issue.AffectedUsers != 2 {
				t.Fatalf("aggregated issue = %#v", issue)
			}
			return
		}
	}

	t.Fatal("没有找到预期的 js_error 聚合结果")
}
