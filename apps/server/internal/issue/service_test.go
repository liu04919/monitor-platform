package issue

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestServiceListPaginatesIssues(t *testing.T) {
	store := &stubStore{issues: []Summary{
		{ID: "issue-3", LastSeen: time.UnixMilli(3_000)},
		{ID: "issue-2", LastSeen: time.UnixMilli(2_000)},
		{ID: "issue-1", LastSeen: time.UnixMilli(1_000)},
	}}

	page, err := NewService(store, allowProject{}).List(context.Background(), ListRequest{
		UserID:    "user-1",
		ProjectID: "project-1",
		Limit:     2,
	})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(page.Issues) != 2 || page.NextCursor == "" {
		t.Fatalf("List() page = %#v", page)
	}

	cursor, err := decodeCursor(page.NextCursor)
	if err != nil {
		t.Fatalf("decodeCursor() error = %v", err)
	}
	if cursor.IssueID != "issue-2" || cursor.LastSeen.UnixMilli() != 2_000 {
		t.Fatalf("cursor = %#v", cursor)
	}
	if store.filter.Limit != 3 {
		t.Fatalf("store limit = %d, want 3", store.filter.Limit)
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
		{name: "invalid limit", request: ListRequest{ProjectID: "project-1", Limit: MaxLimit + 1}, authorizer: allowProject{}, wantErr: ErrInvalidLimit},
		{name: "invalid cursor", request: ListRequest{ProjectID: "project-1", Cursor: "invalid"}, authorizer: allowProject{}, wantErr: ErrInvalidCursor},
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
	store := &stubStore{
		issue: Summary{ID: issueID, Title: "profile failed"},
		found: true,
		occurrences: []Occurrence{
			{EventID: "event-3", Timestamp: time.UnixMilli(3_000)},
			{EventID: "event-2", Timestamp: time.UnixMilli(2_000)},
			{EventID: "event-1", Timestamp: time.UnixMilli(1_000)},
		},
	}

	page, err := NewService(store, allowProject{}).Detail(context.Background(), DetailRequest{
		UserID:    "user-1",
		ProjectID: "project-1",
		IssueID:   issueID,
		Limit:     2,
	})
	if err != nil {
		t.Fatalf("Detail() error = %v", err)
	}
	if page.Issue.ID != issueID || len(page.Occurrences) != 2 || page.NextCursor == "" {
		t.Fatalf("Detail() page = %#v", page)
	}

	cursor, err := decodeOccurrenceCursor(page.NextCursor)
	if err != nil {
		t.Fatalf("decodeOccurrenceCursor() error = %v", err)
	}
	if cursor.EventID != "event-2" || cursor.Timestamp.UnixMilli() != 2_000 {
		t.Fatalf("cursor = %#v", cursor)
	}
	if store.occurrenceFilter.Limit != 3 || store.occurrenceFilter.IssueID != issueID {
		t.Fatalf("occurrence filter = %#v", store.occurrenceFilter)
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
		{name: "invalid limit", request: DetailRequest{ProjectID: "project-1", IssueID: issueID, Limit: MaxLimit + 1}, store: &stubStore{}, authorizer: allowProject{}, wantErr: ErrInvalidLimit},
		{name: "invalid cursor", request: DetailRequest{ProjectID: "project-1", IssueID: issueID, Cursor: "invalid"}, store: &stubStore{}, authorizer: allowProject{}, wantErr: ErrInvalidCursor},
		{name: "foreign project", request: DetailRequest{ProjectID: "project-1", IssueID: issueID}, store: &stubStore{}, authorizer: denyProject{}, wantErr: ErrProjectNotFound},
		{name: "missing issue", request: DetailRequest{ProjectID: "project-1", IssueID: issueID}, store: &stubStore{}, authorizer: allowProject{}, wantErr: ErrIssueNotFound},
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
	issues           []Summary
	issue            Summary
	found            bool
	occurrences      []Occurrence
	err              error
	filter           ListFilter
	occurrenceFilter OccurrenceFilter
}

func (s *stubStore) ListIssues(_ context.Context, filter ListFilter) ([]Summary, error) {
	s.filter = filter
	return s.issues, s.err
}

func (s *stubStore) GetIssue(_ context.Context, _, _ string) (Summary, bool, error) {
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
