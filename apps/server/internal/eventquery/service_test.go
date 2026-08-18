package eventquery

import (
	"context"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

func TestServiceListCreatesStableNextCursor(t *testing.T) {
	timestamp := time.Date(2026, 8, 18, 12, 0, 0, 456_000_000, time.UTC)
	store := &stubStore{
		events: []EventSummary{
			{EventID: "event-3", Timestamp: timestamp.Add(2 * time.Millisecond)},
			{EventID: "event-2", Timestamp: timestamp.Add(time.Millisecond)},
			{EventID: "event-1", Timestamp: timestamp},
		},
	}

	page, err := NewService(store).List(context.Background(), ListRequest{
		ProjectID: " project-1 ",
		Category:  dto.EventCategoryError,
		EventType: " exception ",
		Limit:     2,
	})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(page.Events) != 2 {
		t.Fatalf("len(Events) = %d, want 2", len(page.Events))
	}
	if page.NextCursor == "" {
		t.Fatal("NextCursor 为空，want 非空")
	}
	if store.filter.ProjectID != "project-1" || store.filter.EventType != "exception" {
		t.Fatalf("filter = %#v", store.filter)
	}
	if store.filter.Limit != 3 {
		t.Fatalf("filter.Limit = %d, want 3", store.filter.Limit)
	}

	cursor, err := decodeCursor(page.NextCursor)
	if err != nil {
		t.Fatalf("decodeCursor() error = %v", err)
	}
	if cursor.EventID != "event-2" || !cursor.Timestamp.Equal(timestamp.Add(time.Millisecond)) {
		t.Fatalf("cursor = %#v", cursor)
	}
}

func TestServiceListContinuesFromCursor(t *testing.T) {
	timestamp := time.Date(2026, 8, 18, 12, 0, 0, 123_000_000, time.UTC)
	cursor := encodeCursor(CursorKey{Timestamp: timestamp, EventID: "event-9"})
	store := &stubStore{}

	page, err := NewService(store).List(context.Background(), ListRequest{
		ProjectID: "project-1",
		Cursor:    cursor,
	})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if page.NextCursor != "" {
		t.Fatalf("NextCursor = %q, want empty", page.NextCursor)
	}
	if store.filter.Limit != DefaultLimit+1 {
		t.Fatalf("filter.Limit = %d, want %d", store.filter.Limit, DefaultLimit+1)
	}
	if store.filter.Before == nil || store.filter.Before.EventID != "event-9" || !store.filter.Before.Timestamp.Equal(timestamp) {
		t.Fatalf("filter.Before = %#v", store.filter.Before)
	}
}

func TestServiceListValidatesRequest(t *testing.T) {
	tests := []struct {
		name    string
		request ListRequest
		wantErr error
	}{
		{name: "缺少项目", request: ListRequest{}, wantErr: ErrProjectIDRequired},
		{name: "分类非法", request: ListRequest{ProjectID: "project-1", Category: "unknown"}, wantErr: ErrInvalidCategory},
		{name: "limit 为负数", request: ListRequest{ProjectID: "project-1", Limit: -1}, wantErr: ErrInvalidLimit},
		{name: "limit 超过上限", request: ListRequest{ProjectID: "project-1", Limit: MaxLimit + 1}, wantErr: ErrInvalidLimit},
		{name: "游标不是 Base64", request: ListRequest{ProjectID: "project-1", Cursor: "%%%"}, wantErr: ErrInvalidCursor},
		{name: "游标字段缺失", request: ListRequest{ProjectID: "project-1", Cursor: base64.RawURLEncoding.EncodeToString([]byte(`{"timestamp":1}`))}, wantErr: ErrInvalidCursor},
		{name: "游标时间缺失", request: ListRequest{ProjectID: "project-1", Cursor: base64.RawURLEncoding.EncodeToString([]byte(`{"eventId":"event-1"}`))}, wantErr: ErrInvalidCursor},
		{name: "游标包含未知字段", request: ListRequest{ProjectID: "project-1", Cursor: base64.RawURLEncoding.EncodeToString([]byte(`{"timestamp":1,"eventId":"event-1","extra":true}`))}, wantErr: ErrInvalidCursor},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &stubStore{}
			_, err := NewService(store).List(context.Background(), test.request)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("List() error = %v, want %v", err, test.wantErr)
			}
			if store.calls != 0 {
				t.Fatalf("store calls = %d, want 0", store.calls)
			}
		})
	}
}

func TestServiceListWrapsStoreError(t *testing.T) {
	storeError := errors.New("clickhouse unavailable")
	store := &stubStore{err: storeError}

	_, err := NewService(store).List(context.Background(), ListRequest{ProjectID: "project-1"})
	if !errors.Is(err, storeError) {
		t.Fatalf("List() error = %v, want wrapped %v", err, storeError)
	}
}

type stubStore struct {
	events []EventSummary
	err    error
	calls  int
	filter ListFilter
}

func (s *stubStore) List(_ context.Context, filter ListFilter) ([]EventSummary, error) {
	s.calls++
	s.filter = filter
	return s.events, s.err
}
