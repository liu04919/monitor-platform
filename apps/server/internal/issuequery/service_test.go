package issuequery

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

type stubStore struct {
	issues []Summary
	err    error
	filter ListFilter
}

func (s *stubStore) ListIssues(_ context.Context, filter ListFilter) ([]Summary, error) {
	s.filter = filter
	return s.issues, s.err
}

type allowProject struct{}

func (allowProject) CanAccess(_ context.Context, _, _ string) (bool, error) {
	return true, nil
}

type denyProject struct{}

func (denyProject) CanAccess(_ context.Context, _, _ string) (bool, error) {
	return false, nil
}
