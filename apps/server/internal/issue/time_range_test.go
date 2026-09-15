package issue

import (
	"context"
	"errors"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
	"testing"
)

func TestIssueTimeRangeIsSharedBySummaryAndOccurrences(t *testing.T) {
	r := telemetry.TimeRange{From: 1001, To: 1002}
	store := &stubStore{found: true}
	service := NewService(store, allowProject{})
	_, err := service.List(context.Background(), ListRequest{ProjectID: "p", TimeRange: r})
	if err != nil || store.filter.TimeRange != r {
		t.Fatalf("列表过滤丢失: %v", err)
	}
	_, err = service.Detail(context.Background(), DetailRequest{ProjectID: "p", IssueID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", TimeRange: r})
	if err != nil || store.summaryRange != r || store.occurrenceFilter.TimeRange != r {
		t.Fatalf("摘要与记录区间不一致: %#v, %v", store, err)
	}
	_, err = service.List(context.Background(), ListRequest{ProjectID: "p"})
	if !errors.Is(err, telemetry.ErrInvalidTimeRange) {
		t.Fatalf("缺失区间 error = %v", err)
	}
	_, err = service.Detail(context.Background(), DetailRequest{ProjectID: "p", IssueID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", TimeRange: telemetry.TimeRange{From: 2, To: 1}})
	if !errors.Is(err, telemetry.ErrInvalidTimeRange) {
		t.Fatalf("颠倒区间 error = %v", err)
	}
}
