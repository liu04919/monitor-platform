package project

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
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
	const generatedProjectID = "11111111-1111-4111-8111-111111111111"
	createdAt := time.Date(2026, 8, 20, 1, 2, 3, 0, time.UTC)
	store := &stubStore{}
	service := &Service{
		store:             store,
		generateProjectID: func() (string, error) { return generatedProjectID, nil },
		generatePublicKey: func() (string, error) { return "pk_generated", nil },
		now:               func() time.Time { return createdAt },
	}

	project, err := service.Create(context.Background(), "user-1", CreateRequest{
		Name: " Monitor Web ",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if store.createCalls != 1 {
		t.Fatalf("store create calls = %d, want 1", store.createCalls)
	}
	if project.ID != generatedProjectID || project.Name != "Monitor Web" || !project.Enabled {
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
		{name: "缺少名称", request: CreateRequest{}, wantErr: ErrInvalidProjectName},
		{name: "名称超长", request: CreateRequest{Name: strings.Repeat("中", maxProjectFieldLength+1)}, wantErr: ErrInvalidProjectName},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &stubStore{}
			generatorCalls := 0
			service := &Service{
				store:             store,
				generateProjectID: func() (string, error) { return "11111111-1111-4111-8111-111111111111", nil },
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
		generateProjectID: func() (string, error) { return "11111111-1111-4111-8111-111111111111", nil },
		generatePublicKey: func() (string, error) { return "", generatorError },
		now:               time.Now,
	}
	_, err := service.Create(context.Background(), "user-1", CreateRequest{Name: "Monitor"})
	if !errors.Is(err, generatorError) {
		t.Fatalf("generator error = %v, want wrapped %v", err, generatorError)
	}

	service = &Service{
		store:             &stubStore{},
		generateProjectID: func() (string, error) { return "", generatorError },
		generatePublicKey: func() (string, error) { return "pk_generated", nil },
		now:               time.Now,
	}
	_, err = service.Create(context.Background(), "user-1", CreateRequest{Name: "Monitor"})
	if !errors.Is(err, generatorError) {
		t.Fatalf("project ID generator error = %v, want wrapped %v", err, generatorError)
	}

	storeError := errors.New("postgres unavailable")
	service = &Service{
		store:             &stubStore{createErr: storeError},
		generateProjectID: func() (string, error) { return "11111111-1111-4111-8111-111111111111", nil },
		generatePublicKey: func() (string, error) { return "pk_generated", nil },
		now:               time.Now,
	}
	_, err = service.Create(context.Background(), "user-1", CreateRequest{Name: "Monitor"})
	if !errors.Is(err, storeError) {
		t.Fatalf("store error = %v, want wrapped %v", err, storeError)
	}
}

func TestServiceCreateRetriesGeneratedIDCollision(t *testing.T) {
	store := &stubStore{createErr: ErrProjectIDCollision}
	generated := 0
	service := &Service{
		store: store,
		generateProjectID: func() (string, error) {
			generated++
			return "11111111-1111-4111-8111-111111111111", nil
		},
		generatePublicKey: func() (string, error) { return "pk_generated", nil },
		now:               time.Now,
	}

	_, err := service.Create(context.Background(), "user-1", CreateRequest{Name: "Monitor"})
	if !errors.Is(err, ErrProjectIDCollision) {
		t.Fatalf("Create() error = %v, want %v", err, ErrProjectIDCollision)
	}
	if generated != maxProjectIDGenerateRetries || store.createCalls != maxProjectIDGenerateRetries {
		t.Fatalf("generated = %d, store calls = %d", generated, store.createCalls)
	}
}

func TestServiceCanAccessUsesProjectOwnership(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	store := &stubStore{owns: true}
	allowed, err := NewService(store).CanAccess(context.Background(), " user-1 ", " "+projectID+" ")
	if err != nil {
		t.Fatalf("CanAccess() error = %v", err)
	}
	if !allowed || store.ownerUserID != "user-1" {
		t.Fatalf("allowed = %v, owner = %q", allowed, store.ownerUserID)
	}

	store.ownsErr = errors.New("postgres unavailable")
	if _, err := NewService(store).CanAccess(context.Background(), "user-1", projectID); !errors.Is(err, store.ownsErr) {
		t.Fatalf("CanAccess() error = %v, want wrapped %v", err, store.ownsErr)
	}
}

func TestServiceCanAccessRejectsInvalidProjectIDBeforeStore(t *testing.T) {
	store := &stubStore{owns: true}
	allowed, err := NewService(store).CanAccess(context.Background(), "user-1", "caller-chosen-id")
	if err != nil {
		t.Fatalf("CanAccess() error = %v", err)
	}
	if allowed || store.ownsCalls != 0 {
		t.Fatalf("allowed = %v, store calls = %d", allowed, store.ownsCalls)
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

func TestSecureProjectIDProducesUUID(t *testing.T) {
	projectID, err := secureProjectID()
	if err != nil {
		t.Fatalf("secureProjectID() error = %v", err)
	}
	parsedProjectID, err := uuid.Parse(projectID)
	if err != nil || parsedProjectID.Version() != 4 {
		t.Fatalf("secureProjectID() = %q, want UUID v4", projectID)
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
	ownsCalls      int
}

func (s *stubStore) List(_ context.Context, ownerUserID string) ([]ProjectSummary, error) {
	s.calls++
	s.ownerUserID = ownerUserID
	return s.projects, s.err
}

func (s *stubStore) Owns(_ context.Context, ownerUserID, _ string) (bool, error) {
	s.ownsCalls++
	s.ownerUserID = ownerUserID
	return s.owns, s.ownsErr
}

func (s *stubStore) Create(_ context.Context, project Project) error {
	s.createCalls++
	s.createdProject = project
	return s.createErr
}
