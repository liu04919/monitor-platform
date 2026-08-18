//go:build integration

package clickhouse_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/eventquery"
	clickhousestore "github.com/liu04919/monitor-platform/apps/server/internal/storage/clickhouse"
)

func TestEventReaderListsWithStableCursorAndFilters(t *testing.T) {
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("未设置 TEST_CLICKHOUSE_DSN，跳过事件查询集成测试")
	}

	ctx := context.Background()
	conn, err := database.OpenClickHouse(ctx, database.ClickHouseConfig{DSN: dsn})
	if err != nil {
		t.Fatalf("连接 ClickHouse 失败: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	now := time.Now().UTC().Truncate(time.Millisecond)
	suffix := fmt.Sprintf("%d", now.UnixNano())
	projectID := "event-reader-project-" + suffix
	otherProjectID := "event-reader-other-" + suffix

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		if err := conn.Exec(
			cleanupCtx,
			"ALTER TABLE telemetry_events DELETE WHERE project_id IN (?, ?) SETTINGS mutations_sync = 1",
			projectID,
			otherProjectID,
		); err != nil {
			t.Errorf("清理 ClickHouse 查询测试事件失败: %v", err)
		}
	})

	writer := clickhousestore.NewEventWriter(conn)
	if err := writer.Write(ctx, queryBatch(projectID, "batch-"+suffix, now), "event-reader-token-"+suffix); err != nil {
		t.Fatalf("写入查询测试事件失败: %v", err)
	}
	if err := writer.Write(ctx, queryBatch(otherProjectID, "other-batch-"+suffix, now.Add(time.Second)), "event-reader-other-token-"+suffix); err != nil {
		t.Fatalf("写入其他项目测试事件失败: %v", err)
	}

	service := eventquery.NewService(clickhousestore.NewEventReader(conn))
	firstPage, err := service.List(ctx, eventquery.ListRequest{ProjectID: projectID, Limit: 2})
	if err != nil {
		t.Fatalf("查询第一页失败: %v", err)
	}
	assertEventIDs(t, firstPage.Events, "event-d-"+suffix, "event-c-"+suffix)
	if firstPage.NextCursor == "" {
		t.Fatal("第一页 NextCursor 为空")
	}
	if firstPage.Events[0].Message != "latest performance" {
		t.Fatalf("第一页首条 Message = %q", firstPage.Events[0].Message)
	}

	secondPage, err := service.List(ctx, eventquery.ListRequest{
		ProjectID: projectID,
		Limit:     2,
		Cursor:    firstPage.NextCursor,
	})
	if err != nil {
		t.Fatalf("查询第二页失败: %v", err)
	}
	assertEventIDs(t, secondPage.Events, "event-b-"+suffix, "event-a-"+suffix)
	if secondPage.NextCursor != "" {
		t.Fatalf("第二页 NextCursor = %q, want empty", secondPage.NextCursor)
	}

	errorPage, err := service.List(ctx, eventquery.ListRequest{
		ProjectID: projectID,
		Category:  dto.EventCategoryError,
		EventType: "js_error",
	})
	if err != nil {
		t.Fatalf("按错误类型筛选失败: %v", err)
	}
	assertEventIDs(t, errorPage.Events, "event-c-"+suffix, "event-a-"+suffix)
	if errorPage.Events[0].Level == nil || *errorPage.Events[0].Level != dto.EventLevelError {
		t.Fatalf("错误事件 Level = %#v", errorPage.Events[0].Level)
	}
}

func queryBatch(projectID, batchID string, timestamp time.Time) dto.TelemetryBatch {
	userID := "event-reader-user"
	level := dto.EventLevelError
	suffix := batchID
	if len(batchID) >= len("batch-") && batchID[:len("batch-")] == "batch-" {
		suffix = batchID[len("batch-"):]
	}

	return dto.TelemetryBatch{
		SchemaVersion: 2,
		BatchID:       batchID,
		SentAt:        timestamp.UnixMilli(),
		App:           dto.App{ID: projectID, Name: "EventReader 集成测试"},
		SendType:      dto.SendTypeFetch,
		Events: []dto.TelemetryEvent{
			{
				SchemaVersion: 2,
				EventID:       "event-a-" + suffix,
				Category:      dto.EventCategoryError,
				EventType:     "js_error",
				Timestamp:     timestamp.UnixMilli(),
				PageURL:       "https://example.com/oldest",
				UserID:        &userID,
				Level:         &level,
				Breadcrumbs:   []dto.Breadcrumb{},
				Payload:       json.RawMessage(`{"message":"oldest error"}`),
			},
			{
				SchemaVersion: 2,
				EventID:       "event-b-" + suffix,
				Category:      dto.EventCategoryBehavior,
				EventType:     "custom",
				Timestamp:     timestamp.Add(time.Millisecond).UnixMilli(),
				PageURL:       "https://example.com/middle-b",
				Breadcrumbs:   []dto.Breadcrumb{},
				Payload:       json.RawMessage(`{"message":"middle behavior"}`),
			},
			{
				SchemaVersion: 2,
				EventID:       "event-c-" + suffix,
				Category:      dto.EventCategoryError,
				EventType:     "js_error",
				Timestamp:     timestamp.Add(time.Millisecond).UnixMilli(),
				PageURL:       "https://example.com/middle-c",
				Level:         &level,
				Breadcrumbs:   []dto.Breadcrumb{},
				Payload:       json.RawMessage(`{"message":"middle error"}`),
			},
			{
				SchemaVersion: 2,
				EventID:       "event-d-" + suffix,
				Category:      dto.EventCategoryPerformance,
				EventType:     "page_load",
				Timestamp:     timestamp.Add(2 * time.Millisecond).UnixMilli(),
				PageURL:       "https://example.com/latest",
				Breadcrumbs:   []dto.Breadcrumb{},
				Payload:       json.RawMessage(`{"message":"latest performance"}`),
			},
		},
	}
}

func assertEventIDs(t *testing.T, events []eventquery.EventSummary, want ...string) {
	t.Helper()

	if len(events) != len(want) {
		t.Fatalf("事件数量 = %d, want %d: %#v", len(events), len(want), events)
	}
	for index, event := range events {
		if event.EventID != want[index] {
			t.Fatalf("events[%d].EventID = %q, want %q", index, event.EventID, want[index])
		}
	}
}
