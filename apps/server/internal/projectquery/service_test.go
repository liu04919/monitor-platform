package projectquery

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestServiceListReturnsProjects(t *testing.T) {
	createdAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	store := &stubStore{
		projects: []ProjectSummary{
			{ID: "project-1", Name: "项目一", Enabled: true, CreatedAt: createdAt},
		},
	}

	projects, err := NewService(store).List(context.Background())
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if store.calls != 1 {
		t.Fatalf("store calls = %d, want 1", store.calls)
	}
	if len(projects) != 1 || projects[0].ID != "project-1" {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestServiceListWrapsStoreError(t *testing.T) {
	storeError := errors.New("postgres unavailable")
	store := &stubStore{err: storeError}

	_, err := NewService(store).List(context.Background())
	if !errors.Is(err, storeError) {
		t.Fatalf("List() error = %v, want wrapped %v", err, storeError)
	}
}

type stubStore struct {
	projects []ProjectSummary
	err      error
	calls    int
}

func (s *stubStore) List(_ context.Context) ([]ProjectSummary, error) {
	s.calls++
	return s.projects, s.err
}
