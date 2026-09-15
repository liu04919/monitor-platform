package event

import (
	"context"
	"errors"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
	"testing"
)

func TestListValidatesAndPassesTimeRange(t *testing.T) {
	store := &stubStore{}
	service := NewService(store, allowProject())
	for _, r := range []telemetry.TimeRange{{}, {From: 2, To: 1}, {From: -1, To: 10}} {
		_, err := service.List(context.Background(), ListRequest{ProjectID: "p", TimeRange: r})
		if !errors.Is(err, telemetry.ErrInvalidTimeRange) || store.calls != 0 {
			t.Fatalf("非法时间被查询: %v, calls=%d", err, store.calls)
		}
	}
	r := telemetry.TimeRange{From: 1001, To: 1002}
	_, err := service.List(context.Background(), ListRequest{ProjectID: "p", TimeRange: r})
	if err != nil || store.filter.TimeRange != r {
		t.Fatalf("时间过滤丢失: %#v, %v", store.filter, err)
	}
}
