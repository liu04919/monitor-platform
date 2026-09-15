//go:build integration

package clickhouse_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/event"
	"github.com/liu04919/monitor-platform/apps/server/internal/issue"
	clickhousestore "github.com/liu04919/monitor-platform/apps/server/internal/storage/clickhouse"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

func TestTimeRangeQueriesShareBoundariesAndAggregation(t *testing.T) {
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("未设置 TEST_CLICKHOUSE_DSN，跳过时间区间集成测试")
	}
	ctx := context.Background()
	conn, err := database.OpenClickHouse(ctx, database.ClickHouseConfig{DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	projectID, foreignID := uuid.NewString(), uuid.NewString()
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := conn.Exec(cleanupCtx, "ALTER TABLE telemetry_events DELETE WHERE project_id IN (?, ?) SETTINGS mutations_sync = 1", projectID, foreignID); err != nil {
			t.Error(err)
		}
	})
	base := time.Now().Add(-time.Hour).UnixMilli()
	rangeValue := telemetry.TimeRange{From: base + 1, To: base + 3}
	issueA, issueB := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	fixtures := []struct {
		project, id, fingerprint, user string
		offset                         int64
	}{
		{projectID, "before", issueA, "outside-before", 0},
		{projectID, "a-lower", issueA, "user-1", 1},
		{projectID, "b-tie", issueA, "user-2", 2},
		{projectID, "c-tie", issueA, "user-2", 2},
		{projectID, "upper", issueA, "outside-after", 3},
		{projectID, "d-other", issueB, "user-1", 1},
		{projectID, "old-only", "cccccccccccccccccccccccccccccccc", "outside-only", 0},
		{foreignID, "foreign", issueA, "foreign-user", 2},
	}
	for _, row := range fixtures {
		err := conn.Exec(ctx, `INSERT INTO telemetry_events
			(schema_version, project_id, event_id, category, event_type, event_timestamp, user_id, payload_json, issue_fingerprint)
			VALUES (2, ?, ?, 'error', 'js_error', fromUnixTimestamp64Milli(?), ?, ?, ?)`,
			row.project, row.id, base+row.offset, row.user, `{"exception":{"name":"TypeError","message":"`+row.id+`"}}`, row.fingerprint)
		if err != nil {
			t.Fatal(err)
		}
	}

	events := event.NewService(clickhousestore.NewEventReader(conn), allowAllProjects{})
	request := event.ListRequest{UserID: "test", ProjectID: projectID, TimeRange: rangeValue, Pagination: telemetry.Pagination{PageSize: 2}, Category: telemetry.CategoryError, EventType: "js_error"}
	first, err := events.List(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	assertEventIDs(t, first.Events, "c-tie", "b-tie")
	if first.Total != 4 || first.Page != 1 || first.PageSize != 2 {
		t.Fatalf("第一页 = %#v", first)
	}
	request.Page = 2
	second, err := events.List(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	assertEventIDs(t, second.Events, "d-other", "a-lower")
	if second.Total != 4 || second.Page != 2 {
		t.Fatalf("第二页 = %#v", second)
	}

	issues := issue.NewService(clickhousestore.NewIssueReader(conn), allowAllProjects{})
	listRequest := issue.ListRequest{UserID: "test", ProjectID: projectID, TimeRange: rangeValue, Pagination: telemetry.Pagination{PageSize: 1}}
	page, err := issues.List(ctx, listRequest)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Issues) != 1 || page.Issues[0].ID != issueA || page.Total != 2 || page.Page != 1 {
		t.Fatalf("第一页问题 = %#v", page)
	}
	summary := page.Issues[0]
	if summary.EventCount != 3 || summary.AffectedUsers != 2 || summary.FirstSeen.UnixMilli() != base+1 || summary.LastSeen.UnixMilli() != base+2 || summary.LatestEventID != "c-tie" || summary.Title != "c-tie" {
		t.Fatalf("区间聚合不一致: %#v", summary)
	}
	listRequest.Page = 2
	page, err = issues.List(ctx, listRequest)
	if err != nil || len(page.Issues) != 1 || page.Issues[0].ID != issueB || page.Total != 2 || page.Page != 2 {
		t.Fatalf("第二页问题 = %#v, %v", page, err)
	}

	detailRequest := issue.DetailRequest{UserID: "test", ProjectID: projectID, IssueID: issueA, TimeRange: rangeValue, Pagination: telemetry.Pagination{PageSize: 2}}
	detail, err := issues.Detail(ctx, detailRequest)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Issue != summary || len(detail.Occurrences) != 2 || detail.Occurrences[0].EventID != "c-tie" || detail.Occurrences[1].EventID != "b-tie" || detail.Total != 3 || detail.Page != 1 {
		t.Fatalf("详情第一页 = %#v", detail)
	}
	detailRequest.Page = 2
	detail, err = issues.Detail(ctx, detailRequest)
	if err != nil || len(detail.Occurrences) != 1 || detail.Occurrences[0].EventID != "a-lower" || detail.Total != 3 || detail.Page != 2 {
		t.Fatalf("详情第二页 = %#v, %v", detail, err)
	}

	// 任意跳页不依赖之前的请求；越界保留总数，方便用户回到有效页。
	request.Page, request.PageSize = 3, 1
	jumped, err := events.List(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	assertEventIDs(t, jumped.Events, "d-other")
	request.Page = 99
	outside, err := events.List(ctx, request)
	if err != nil || outside.Total != 4 || len(outside.Events) != 0 {
		t.Fatalf("越界页 = %#v, %v", outside, err)
	}
	listRequest.Page = 99
	outsideIssues, err := issues.List(ctx, listRequest)
	if err != nil || outsideIssues.Total != 2 || len(outsideIssues.Issues) != 0 {
		t.Fatalf("问题越界页 = %#v, %v", outsideIssues, err)
	}
	detailRequest.Page = 99
	outsideDetail, err := issues.Detail(ctx, detailRequest)
	if err != nil || outsideDetail.Total != 3 || len(outsideDetail.Occurrences) != 0 {
		t.Fatalf("发生记录越界页 = %#v, %v", outsideDetail, err)
	}
	request.Page = 1
	request.EventType = "resource_error"
	empty, err := events.List(ctx, request)
	if err != nil || empty.Total != 0 || len(empty.Events) != 0 {
		t.Fatalf("空筛选 = %#v, %v", empty, err)
	}

	// 改变窗口后重新从第一页查，计数、去重用户和最近事件一起变化。
	detailRequest.Page = 1
	detailRequest.TimeRange = telemetry.TimeRange{From: base + 3, To: base + 4}
	detail, err = issues.Detail(ctx, detailRequest)
	if err != nil || detail.Issue.EventCount != 1 || detail.Issue.AffectedUsers != 1 || detail.Issue.LatestEventID != "upper" {
		t.Fatalf("新窗口详情 = %#v, %v", detail, err)
	}
	detailRequest.TimeRange = telemetry.TimeRange{From: base + 4, To: base + 5}
	if _, err := issues.Detail(ctx, detailRequest); !errors.Is(err, issue.ErrIssueNotFound) {
		t.Fatalf("空窗口 error = %v", err)
	}
}
