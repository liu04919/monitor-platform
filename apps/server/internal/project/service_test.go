package project

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestServiceListReturnsProjects(t *testing.T) {
	createdAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	store := &stubStore{
		projects: []ProjectSummary{
			{ID: "project-1", Name: "项目一", Enabled: true, CreatedAt: createdAt},
		},
	}

	projects, err := NewService(store).List(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if store.calls != 1 {
		t.Fatalf("store calls = %d, want 1", store.calls)
	}
	if store.ownerUserID != "user-1" {
		t.Fatalf("owner user ID = %q", store.ownerUserID)
	}
	if len(projects) != 1 || projects[0].ID != "project-1" {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestServiceListWrapsStoreError(t *testing.T) {
	storeError := errors.New("postgres unavailable")
	store := &stubStore{err: storeError}

	_, err := NewService(store).List(context.Background(), "user-1")
	if !errors.Is(err, storeError) {
		t.Fatalf("List() error = %v, want wrapped %v", err, storeError)
	}
}

func TestServiceCreateValidatesAndBuildsProject(t *testing.T) {
	createdAt := time.Date(2026, 8, 20, 1, 2, 3, 0, time.UTC)
	store := &stubStore{}
	service := &Service{
		store:             store,
		generatePublicKey: func() (string, error) { return "pk_generated", nil },
		now:               func() time.Time { return createdAt },
	}

	project, err := service.Create(context.Background(), "user-1", CreateRequest{
		ID:   " monitor-web ",
		Name: " Monitor Web ",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if store.createCalls != 1 {
		t.Fatalf("store create calls = %d, want 1", store.createCalls)
	}
	if project.ID != "monitor-web" || project.Name != "Monitor Web" || !project.Enabled {
		t.Fatalf("project = %#v", project)
	}
	if project.PublicKey != "pk_generated" || !project.CreatedAt.Equal(createdAt) {
		t.Fatalf("generated project = %#v", project)
	}
	if project.OwnerUserID != "user-1" {
		t.Fatalf("owner user ID = %q", project.OwnerUserID)
	}
	if store.createdProject != project {
		t.Fatalf("stored project = %#v, want %#v", store.createdProject, project)
	}
}

func TestServiceCreateValidatesRequestBeforeGeneratingKey(t *testing.T) {
	tests := []struct {
		name    string
		request CreateRequest
		wantErr error
	}{
		{name: "缺少 ID", request: CreateRequest{Name: "Monitor"}, wantErr: ErrInvalidProjectID},
		{name: "ID 含大写", request: CreateRequest{ID: "Monitor-Web", Name: "Monitor"}, wantErr: ErrInvalidProjectID},
		{name: "ID 含下划线", request: CreateRequest{ID: "monitor_web", Name: "Monitor"}, wantErr: ErrInvalidProjectID},
		{name: "ID 以连字符结尾", request: CreateRequest{ID: "monitor-", Name: "Monitor"}, wantErr: ErrInvalidProjectID},
		{name: "ID 超长", request: CreateRequest{ID: strings.Repeat("a", maxProjectFieldLength+1), Name: "Monitor"}, wantErr: ErrInvalidProjectID},
		{name: "缺少名称", request: CreateRequest{ID: "monitor"}, wantErr: ErrInvalidProjectName},
		{name: "名称超长", request: CreateRequest{ID: "monitor", Name: strings.Repeat("中", maxProjectFieldLength+1)}, wantErr: ErrInvalidProjectName},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &stubStore{}
			generatorCalls := 0
			service := &Service{
				store: store,
				generatePublicKey: func() (string, error) {
					generatorCalls++
					return "pk_generated", nil
				},
				now: time.Now,
			}

			_, err := service.Create(context.Background(), "user-1", test.request)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Create() error = %v, want %v", err, test.wantErr)
			}
			if generatorCalls != 0 || store.createCalls != 0 {
				t.Fatalf("generator calls = %d, store calls = %d", generatorCalls, store.createCalls)
			}
		})
	}
}

func TestServiceCreateWrapsGeneratorAndStoreErrors(t *testing.T) {
	generatorError := errors.New("entropy unavailable")
	service := &Service{
		store:             &stubStore{},
		generatePublicKey: func() (string, error) { return "", generatorError },
		now:               time.Now,
	}
	_, err := service.Create(context.Background(), "user-1", CreateRequest{ID: "monitor", Name: "Monitor"})
	if !errors.Is(err, generatorError) {
		t.Fatalf("generator error = %v, want wrapped %v", err, generatorError)
	}

	storeError := ErrProjectIDConflict
	service = &Service{
		store:             &stubStore{createErr: storeError},
		generatePublicKey: func() (string, error) { return "pk_generated", nil },
		now:               time.Now,
	}
	_, err = service.Create(context.Background(), "user-1", CreateRequest{ID: "monitor", Name: "Monitor"})
	if !errors.Is(err, storeError) {
		t.Fatalf("store error = %v, want wrapped %v", err, storeError)
	}
}

func TestServiceCanAccessUsesProjectOwnership(t *testing.T) {
	store := &stubStore{owns: true}
	allowed, err := NewService(store).CanAccess(context.Background(), " user-1 ", " project-1 ")
	if err != nil {
		t.Fatalf("CanAccess() error = %v", err)
	}
	if !allowed || store.ownerUserID != "user-1" {
		t.Fatalf("allowed = %v, owner = %q", allowed, store.ownerUserID)
	}

	store.ownsErr = errors.New("postgres unavailable")
	if _, err := NewService(store).CanAccess(context.Background(), "user-1", "project-1"); !errors.Is(err, store.ownsErr) {
		t.Fatalf("CanAccess() error = %v, want wrapped %v", err, store.ownsErr)
	}
}

func TestSecurePublicKeyProducesSDKSafeValue(t *testing.T) {
	first, err := securePublicKey()
	if err != nil {
		t.Fatalf("securePublicKey() error = %v", err)
	}
	second, err := securePublicKey()
	if err != nil {
		t.Fatalf("securePublicKey() second error = %v", err)
	}
	if first == second || !strings.HasPrefix(first, "pk_") || utf8.RuneCountInString(first) > maxProjectFieldLength {
		t.Fatalf("generated keys = %q, %q", first, second)
	}
}

type stubStore struct {
	projects       []ProjectSummary
	err            error
	calls          int
	createdProject Project
	createErr      error
	createCalls    int
	ownerUserID    string
	owns           bool
	ownsErr        error
}

func (s *stubStore) List(_ context.Context, ownerUserID string) ([]ProjectSummary, error) {
	s.calls++
	s.ownerUserID = ownerUserID
	return s.projects, s.err
}

func (s *stubStore) Owns(_ context.Context, ownerUserID, _ string) (bool, error) {
	s.ownerUserID = ownerUserID
	return s.owns, s.ownsErr
}

func (s *stubStore) Create(_ context.Context, project Project) error {
	s.createCalls++
	s.createdProject = project
	return s.createErr
}
