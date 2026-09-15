package event

import (
	"context"
	"errors"
	"testing"

	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

func TestServiceListUsesPageOffsetAndTotal(t *testing.T) {
	store := &stubStore{events: []EventSummary{{EventID: "event-1"}}, total: 61}
	page, err := NewService(store, allowProject()).List(context.Background(), ListRequest{
		TimeRange: telemetry.TimeRange{From: 0, To: 10000},
		UserID:    "user-1", ProjectID: " project-1 ", Category: telemetry.CategoryError,
		EventType: " js_error ", Pagination: telemetry.Pagination{Page: 3, PageSize: 30},
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Page != 3 || page.PageSize != 30 || page.Total != 61 || len(page.Events) != 1 {
		t.Fatalf("page = %#v", page)
	}
	if store.filter.Offset != 60 || store.filter.Limit != 30 || store.filter.ProjectID != "project-1" || store.filter.EventType != "js_error" {
		t.Fatalf("filter = %#v", store.filter)
	}
}

func TestServiceListDefaultsAndEmptyPage(t *testing.T) {
	store := &stubStore{}
	page, err := NewService(store, allowProject()).List(context.Background(), ListRequest{
		ProjectID: "project-1", TimeRange: telemetry.TimeRange{From: 0, To: 10000},
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Page != 1 || page.PageSize != 30 || page.Total != 0 || store.filter.Offset != 0 || store.filter.Limit != 30 {
		t.Fatalf("page = %#v, filter = %#v", page, store.filter)
	}
}

func TestServiceListValidatesRequest(t *testing.T) {
	tests := []struct {
		name    string
		request ListRequest
		wantErr error
	}{
		{name: "缺少项目", request: ListRequest{}, wantErr: ErrProjectIDRequired},
		{name: "非法页码", request: ListRequest{ProjectID: "project-1", Pagination: telemetry.Pagination{Page: -1}}, wantErr: telemetry.ErrInvalidPage},
		{name: "每页超过上限", request: ListRequest{ProjectID: "project-1", Pagination: telemetry.Pagination{PageSize: 101}}, wantErr: telemetry.ErrInvalidPageSize},
		{name: "分类非法", request: ListRequest{ProjectID: "project-1", Category: "unknown"}, wantErr: ErrInvalidCategory},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &stubStore{}
			_, err := NewService(store, allowProject()).List(context.Background(), test.request)
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

	_, err := NewService(store, allowProject()).List(context.Background(), ListRequest{UserID: "user-1", ProjectID: "project-1", TimeRange: telemetry.TimeRange{From: 0, To: 10000}})
	if !errors.Is(err, storeError) {
		t.Fatalf("List() error = %v, want wrapped %v", err, storeError)
	}
}

func TestServiceListRejectsProjectNotOwnedByUser(t *testing.T) {
	store := &stubStore{}
	_, err := NewService(store, &stubProjectAuthorizer{}).List(context.Background(), ListRequest{
		UserID:    "user-2",
		ProjectID: "project-1",
	})
	if !errors.Is(err, ErrProjectNotFound) {
		t.Fatalf("List() error = %v, want %v", err, ErrProjectNotFound)
	}
	if store.calls != 0 {
		t.Fatalf("ClickHouse calls = %d, want 0", store.calls)
	}
}

type stubProjectAuthorizer struct {
	allowed bool
	err     error
}

func allowProject() *stubProjectAuthorizer {
	return &stubProjectAuthorizer{allowed: true}
}

func (a *stubProjectAuthorizer) CanAccess(_ context.Context, _, _ string) (bool, error) {
	return a.allowed, a.err
}

type stubStore struct {
	total        uint64
	events       []EventSummary
	err          error
	calls        int
	filter       ListFilter
	detail       EventDetail
	found        bool
	getErr       error
	getCalls     int
	getProjectID string
	getEventID   string
}

func (s *stubStore) Get(_ context.Context, projectID, eventID string) (EventDetail, bool, error) {
	s.getCalls++
	s.getProjectID = projectID
	s.getEventID = eventID
	return s.detail, s.found, s.getErr
}

func (s *stubStore) List(_ context.Context, filter ListFilter) ([]EventSummary, uint64, error) {
	s.calls++
	s.filter = filter
	return s.events, s.total, s.err
}
