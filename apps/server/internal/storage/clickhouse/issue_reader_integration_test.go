//go:build integration

package clickhouse_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/issue"
	clickhousestore "github.com/liu04919/monitor-platform/apps/server/internal/storage/clickhouse"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
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
	issueID := "0123456789abcdef0123456789abcdef"
	now := time.Now().UTC().Truncate(time.Millisecond)
	payload := `{"exception":{"name":"TypeError","message":"profile failed","stack":[{"filename":"https://example.com/app.js","functionName":"renderProfile","line":42,"column":7}]}}`
	insertSQL := `
		INSERT INTO telemetry_events
		(
			schema_version, project_id, app_name, batch_id, send_type, sent_at,
			event_id, category, event_type, event_timestamp, page_url,
			user_id, level, breadcrumbs_json, replay_data, payload_json, issue_fingerprint
		)
		VALUES (?, ?, ?, ?, ?, fromUnixTimestamp64Milli(?), ?, ?, ?, fromUnixTimestamp64Milli(?), ?, ?, ?, ?, ?, ?, ?)
	`
	for index, userID := range []string{"user-1", "user-2"} {
		if err := conn.Exec(
			ctx,
			insertSQL,
			uint16(2), projectID, "IssueReader 测试", "batch-1", "fetch", now.UnixMilli(),
			"event-"+userID, "error", "js_error", now.Add(time.Duration(index)*time.Millisecond).UnixMilli(),
			"https://example.com/profile", userID, "error", "[]", nil, payload, issueID,
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
	timeRange := telemetry.TimeRange{From: now.UnixMilli(), To: now.Add(time.Second).UnixMilli()}
	issues, err := reader.ListIssues(ctx, issue.ListFilter{
		TimeRange: timeRange,
		ProjectID: projectID,
		Limit:     30,
	})
	if err != nil {
		t.Fatalf("ListIssues() error = %v", err)
	}

	if len(issues) != 1 {
		t.Fatalf("len(issues) = %d, want 1", len(issues))
	}
	for _, summary := range issues {
		if summary.EventType == "js_error" && summary.Title == "profile failed" {
			if summary.EventCount != 2 || summary.AffectedUsers != 2 {
				t.Fatalf("aggregated issue = %#v", summary)
			}
			break
		}
	}

	summary, found, err := reader.GetIssue(ctx, projectID, issueID, timeRange)
	if err != nil {
		t.Fatalf("GetIssue() error = %v", err)
	}
	if !found || summary.EventCount != 2 || summary.ID != issueID {
		t.Fatalf("GetIssue() = %#v, found = %t", summary, found)
	}

	firstPage, err := reader.ListOccurrences(ctx, issue.OccurrenceFilter{
		TimeRange: timeRange,
		ProjectID: projectID,
		IssueID:   issueID,
		Limit:     1,
	})
	if err != nil {
		t.Fatalf("ListOccurrences() first page error = %v", err)
	}
	if len(firstPage) != 1 || firstPage[0].EventID != "event-user-2" {
		t.Fatalf("first occurrences page = %#v", firstPage)
	}

	secondPage, err := reader.ListOccurrences(ctx, issue.OccurrenceFilter{
		TimeRange: timeRange,
		ProjectID: projectID,
		IssueID:   issueID,
		Before: &issue.OccurrenceCursorKey{
			Timestamp: firstPage[0].Timestamp,
			EventID:   firstPage[0].EventID,
		},
		Limit: 1,
	})
	if err != nil {
		t.Fatalf("ListOccurrences() second page error = %v", err)
	}
	if len(secondPage) != 1 || secondPage[0].EventID != "event-user-1" {
		t.Fatalf("second occurrences page = %#v", secondPage)
	}
}
