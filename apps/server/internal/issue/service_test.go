package issue

import (
	"context"
	"errors"
	"testing"

	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

func TestServiceListPaginatesIssues(t *testing.T) {
	store := &stubStore{issues: []Summary{{ID: "issue-1"}}, total: 61}
	page, err := NewService(store, allowProject{}).List(context.Background(), ListRequest{
		ProjectID: "project-1", TimeRange: telemetry.TimeRange{From: 1000, To: 4000},
		Pagination: telemetry.Pagination{Page: 3, PageSize: 30},
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Page != 3 || page.PageSize != 30 || page.Total != 61 || len(page.Issues) != 1 || store.filter.Offset != 60 || store.filter.Limit != 30 {
		t.Fatalf("page = %#v, filter = %#v", page, store.filter)
	}
}

func TestServiceListValidatesInputAndAuthorization(t *testing.T) {
	tests := []struct {
		name       string
		request    ListRequest
		authorizer ProjectAuthorizer
		wantErr    error
	}{
		{name: "missing project", request: ListRequest{}, authorizer: allowProject{}, wantErr: ErrProjectIDRequired},
		{name: "invalid page size", request: ListRequest{ProjectID: "project-1", Pagination: telemetry.Pagination{PageSize: 101}}, authorizer: allowProject{}, wantErr: telemetry.ErrInvalidPageSize},
		{name: "invalid page", request: ListRequest{ProjectID: "project-1", Pagination: telemetry.Pagination{Page: -1}}, authorizer: allowProject{}, wantErr: telemetry.ErrInvalidPage},
		{name: "foreign project", request: ListRequest{ProjectID: "project-1"}, authorizer: denyProject{}, wantErr: ErrProjectNotFound},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NewService(&stubStore{}, test.authorizer).List(context.Background(), test.request)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("List() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestServiceDetailPaginatesOccurrences(t *testing.T) {
	issueID := "0123456789abcdef0123456789abcdef"
	store := &stubStore{issue: Summary{ID: issueID, EventCount: 61}, found: true, occurrences: []Occurrence{{EventID: "event-1"}}}
	page, err := NewService(store, allowProject{}).Detail(context.Background(), DetailRequest{
		ProjectID: "project-1", IssueID: issueID, TimeRange: telemetry.TimeRange{From: 1000, To: 4000},
		Pagination: telemetry.Pagination{Page: 3, PageSize: 30},
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Page != 3 || page.PageSize != 30 || page.Total != 61 || len(page.Occurrences) != 1 || store.occurrenceFilter.Offset != 60 || store.occurrenceFilter.Limit != 30 || store.occurrenceFilter.IssueID != issueID {
		t.Fatalf("page = %#v, filter = %#v", page, store.occurrenceFilter)
	}
}

func TestServiceDetailValidatesInputAuthorizationAndExistence(t *testing.T) {
	issueID := "0123456789abcdef0123456789abcdef"
	tests := []struct {
		name       string
		request    DetailRequest
		store      *stubStore
		authorizer ProjectAuthorizer
		wantErr    error
	}{
		{name: "missing project", request: DetailRequest{}, store: &stubStore{}, authorizer: allowProject{}, wantErr: ErrProjectIDRequired},
		{name: "invalid issue ID", request: DetailRequest{ProjectID: "project-1", IssueID: "not-a-fingerprint"}, store: &stubStore{}, authorizer: allowProject{}, wantErr: ErrInvalidIssueID},
		{name: "invalid page size", request: DetailRequest{ProjectID: "project-1", IssueID: issueID, Pagination: telemetry.Pagination{PageSize: 101}}, store: &stubStore{}, authorizer: allowProject{}, wantErr: telemetry.ErrInvalidPageSize},
		{name: "invalid page", request: DetailRequest{ProjectID: "project-1", IssueID: issueID, Pagination: telemetry.Pagination{Page: -1}}, store: &stubStore{}, authorizer: allowProject{}, wantErr: telemetry.ErrInvalidPage},
		{name: "foreign project", request: DetailRequest{ProjectID: "project-1", IssueID: issueID}, store: &stubStore{}, authorizer: denyProject{}, wantErr: ErrProjectNotFound},
		{name: "missing issue", request: DetailRequest{ProjectID: "project-1", IssueID: issueID, TimeRange: telemetry.TimeRange{From: 1000, To: 4000}}, store: &stubStore{}, authorizer: allowProject{}, wantErr: ErrIssueNotFound},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NewService(test.store, test.authorizer).Detail(context.Background(), test.request)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Detail() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

type stubStore struct {
	total            uint64
	issues           []Summary
	issue            Summary
	found            bool
	occurrences      []Occurrence
	err              error
	filter           ListFilter
	occurrenceFilter OccurrenceFilter
	summaryRange     telemetry.TimeRange
}

func (s *stubStore) ListIssues(_ context.Context, filter ListFilter) ([]Summary, uint64, error) {
	s.filter = filter
	return s.issues, s.total, s.err
}

func (s *stubStore) GetIssue(_ context.Context, _, _ string, timeRange telemetry.TimeRange) (Summary, bool, error) {
	s.summaryRange = timeRange
	return s.issue, s.found, s.err
}

func (s *stubStore) ListOccurrences(_ context.Context, filter OccurrenceFilter) ([]Occurrence, error) {
	s.occurrenceFilter = filter
	return s.occurrences, s.err
}

type allowProject struct{}

func (allowProject) CanAccess(_ context.Context, _, _ string) (bool, error) {
	return true, nil
}

type denyProject struct{}

func (denyProject) CanAccess(_ context.Context, _, _ string) (bool, error) {
	return false, nil
}
