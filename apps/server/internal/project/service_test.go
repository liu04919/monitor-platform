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

func TestServiceGetReturnsOwnedProject(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	createdAt := time.Date(2026, 8, 22, 1, 2, 3, 0, time.UTC)
	store := &stubStore{foundProject: Project{
		ProjectSummary: ProjectSummary{
			ID:        projectID,
			Name:      "Monitor Web",
			Enabled:   true,
			CreatedAt: createdAt,
		},
		OwnerUserID: "user-1",
		PublicKey:   "pk_generated",
	}}

	foundProject, err := NewService(store).Get(context.Background(), " user-1 ", " "+projectID+" ")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if store.getCalls != 1 || store.ownerUserID != "user-1" || store.projectID != projectID {
		t.Fatalf("store get = calls %d, owner %q, project %q", store.getCalls, store.ownerUserID, store.projectID)
	}
	if foundProject != store.foundProject {
		t.Fatalf("project = %#v, want %#v", foundProject, store.foundProject)
	}
}

func TestServiceGetHidesInvalidAndMissingProject(t *testing.T) {
	store := &stubStore{}
	_, err := NewService(store).Get(context.Background(), "user-1", "caller-chosen-id")
	if !errors.Is(err, ErrProjectNotFound) || store.getCalls != 0 {
		t.Fatalf("invalid project error = %v, store calls = %d", err, store.getCalls)
	}

	store.getErr = ErrProjectNotFound
	_, err = NewService(store).Get(
		context.Background(),
		"user-1",
		"11111111-1111-4111-8111-111111111111",
	)
	if !errors.Is(err, ErrProjectNotFound) {
		t.Fatalf("missing project error = %v, want %v", err, ErrProjectNotFound)
	}
}

func TestServiceGetWrapsStoreError(t *testing.T) {
	storeError := errors.New("postgres unavailable")
	store := &stubStore{getErr: storeError}

	_, err := NewService(store).Get(
		context.Background(),
		"user-1",
		"11111111-1111-4111-8111-111111111111",
	)
	if !errors.Is(err, storeError) {
		t.Fatalf("Get() error = %v, want wrapped %v", err, storeError)
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

func TestServiceUpdateNormalizesAndUpdatesOwnedProject(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	name := " Monitor Web "
	enabled := false
	store := &stubStore{updatedProject: Project{
		ProjectSummary: ProjectSummary{ID: projectID, Name: "Monitor Web", Enabled: false},
		OwnerUserID:    "user-1",
		PublicKey:      "pk_generated",
	}}

	updatedProject, err := NewService(store).Update(
		context.Background(),
		" user-1 ",
		" "+projectID+" ",
		UpdateRequest{Name: &name, Enabled: &enabled},
	)
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if store.updateCalls != 1 || store.ownerUserID != "user-1" || store.projectID != projectID {
		t.Fatalf("store update = calls %d, owner %q, project %q", store.updateCalls, store.ownerUserID, store.projectID)
	}
	if store.updateRequest.Name == nil || *store.updateRequest.Name != "Monitor Web" {
		t.Fatalf("update request name = %#v", store.updateRequest.Name)
	}
	if store.updateRequest.Enabled == nil || *store.updateRequest.Enabled {
		t.Fatalf("update request enabled = %#v", store.updateRequest.Enabled)
	}
	if updatedProject != store.updatedProject {
		t.Fatalf("updated project = %#v, want %#v", updatedProject, store.updatedProject)
	}
}

func TestServiceUpdateValidatesBeforeStore(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	emptyName := "  "
	longName := strings.Repeat("中", maxProjectFieldLength+1)
	tests := []struct {
		name        string
		ownerUserID string
		projectID   string
		request     UpdateRequest
		wantErr     error
	}{
		{name: "缺少用户", projectID: projectID, request: UpdateRequest{Enabled: boolPointer(false)}, wantErr: ErrOwnerUserIDRequired},
		{name: "项目 ID 无效", ownerUserID: "user-1", projectID: "caller-chosen-id", request: UpdateRequest{Enabled: boolPointer(false)}, wantErr: ErrProjectNotFound},
		{name: "没有更新字段", ownerUserID: "user-1", projectID: projectID, wantErr: ErrNoProjectUpdates},
		{name: "名称为空", ownerUserID: "user-1", projectID: projectID, request: UpdateRequest{Name: &emptyName}, wantErr: ErrInvalidProjectName},
		{name: "名称超长", ownerUserID: "user-1", projectID: projectID, request: UpdateRequest{Name: &longName}, wantErr: ErrInvalidProjectName},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &stubStore{}
			_, err := NewService(store).Update(
				context.Background(),
				test.ownerUserID,
				test.projectID,
				test.request,
			)
			if !errors.Is(err, test.wantErr) || store.updateCalls != 0 {
				t.Fatalf("Update() error = %v, want %v, store calls = %d", err, test.wantErr, store.updateCalls)
			}
		})
	}
}

func TestServiceUpdateMapsStoreErrors(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	enabled := false

	store := &stubStore{updateErr: ErrProjectNotFound}
	_, err := NewService(store).Update(
		context.Background(),
		"user-1",
		projectID,
		UpdateRequest{Enabled: &enabled},
	)
	if !errors.Is(err, ErrProjectNotFound) {
		t.Fatalf("Update() not found error = %v, want %v", err, ErrProjectNotFound)
	}

	storeError := errors.New("postgres unavailable")
	store = &stubStore{updateErr: storeError}
	_, err = NewService(store).Update(
		context.Background(),
		"user-1",
		projectID,
		UpdateRequest{Enabled: &enabled},
	)
	if !errors.Is(err, storeError) {
		t.Fatalf("Update() error = %v, want wrapped %v", err, storeError)
	}
}

func TestServiceRotatePublicKeyGeneratesAndStoresNewKey(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	store := &stubStore{rotatedProject: Project{
		ProjectSummary: ProjectSummary{ID: projectID, Name: "Monitor", Enabled: true},
		OwnerUserID:    "user-1",
		PublicKey:      "pk_new",
	}}
	service := NewService(store)
	service.generatePublicKey = func() (string, error) { return "pk_new", nil }

	rotatedProject, err := service.RotatePublicKey(
		context.Background(),
		" user-1 ",
		" "+projectID+" ",
	)
	if err != nil {
		t.Fatalf("RotatePublicKey() error = %v", err)
	}
	if store.rotateCalls != 1 || store.ownerUserID != "user-1" || store.projectID != projectID {
		t.Fatalf("store rotate = calls %d, owner %q, project %q", store.rotateCalls, store.ownerUserID, store.projectID)
	}
	if store.rotatedPublicKey != "pk_new" || rotatedProject.PublicKey != "pk_new" {
		t.Fatalf("rotated public key = store %q, project %#v", store.rotatedPublicKey, rotatedProject)
	}
}

func TestServiceRotatePublicKeyValidatesBeforeGenerating(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	tests := []struct {
		name        string
		ownerUserID string
		projectID   string
		wantErr     error
	}{
		{name: "缺少用户", projectID: projectID, wantErr: ErrOwnerUserIDRequired},
		{name: "项目 ID 无效", ownerUserID: "user-1", projectID: "caller-chosen-id", wantErr: ErrProjectNotFound},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &stubStore{}
			generatorCalls := 0
			service := NewService(store)
			service.generatePublicKey = func() (string, error) {
				generatorCalls++
				return "pk_new", nil
			}

			_, err := service.RotatePublicKey(
				context.Background(),
				test.ownerUserID,
				test.projectID,
			)
			if !errors.Is(err, test.wantErr) || generatorCalls != 0 || store.rotateCalls != 0 {
				t.Fatalf(
					"RotatePublicKey() error = %v, want %v, generator calls = %d, store calls = %d",
					err,
					test.wantErr,
					generatorCalls,
					store.rotateCalls,
				)
			}
		})
	}
}

func TestServiceRotatePublicKeyWrapsGeneratorAndStoreErrors(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	generatorError := errors.New("entropy unavailable")
	service := NewService(&stubStore{})
	service.generatePublicKey = func() (string, error) { return "", generatorError }
	_, err := service.RotatePublicKey(context.Background(), "user-1", projectID)
	if !errors.Is(err, generatorError) {
		t.Fatalf("generator error = %v, want wrapped %v", err, generatorError)
	}

	store := &stubStore{rotateErr: ErrProjectNotFound}
	service = NewService(store)
	service.generatePublicKey = func() (string, error) { return "pk_new", nil }
	_, err = service.RotatePublicKey(context.Background(), "user-1", projectID)
	if !errors.Is(err, ErrProjectNotFound) {
		t.Fatalf("missing project error = %v, want %v", err, ErrProjectNotFound)
	}

	storeError := errors.New("postgres unavailable")
	store = &stubStore{rotateErr: storeError}
	service = NewService(store)
	service.generatePublicKey = func() (string, error) { return "pk_new", nil }
	_, err = service.RotatePublicKey(context.Background(), "user-1", projectID)
	if !errors.Is(err, storeError) {
		t.Fatalf("store error = %v, want wrapped %v", err, storeError)
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
	projects         []ProjectSummary
	err              error
	calls            int
	createdProject   Project
	createErr        error
	createCalls      int
	ownerUserID      string
	owns             bool
	ownsErr          error
	ownsCalls        int
	foundProject     Project
	getErr           error
	getCalls         int
	projectID        string
	updatedProject   Project
	updateRequest    UpdateRequest
	updateErr        error
	updateCalls      int
	rotatedProject   Project
	rotatedPublicKey string
	rotateErr        error
	rotateCalls      int
}

func (s *stubStore) List(_ context.Context, ownerUserID string) ([]ProjectSummary, error) {
	s.calls++
	s.ownerUserID = ownerUserID
	return s.projects, s.err
}

func (s *stubStore) Get(_ context.Context, ownerUserID, projectID string) (Project, error) {
	s.getCalls++
	s.ownerUserID = ownerUserID
	s.projectID = projectID
	return s.foundProject, s.getErr
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

func (s *stubStore) Update(
	_ context.Context,
	ownerUserID string,
	projectID string,
	request UpdateRequest,
) (Project, error) {
	s.updateCalls++
	s.ownerUserID = ownerUserID
	s.projectID = projectID
	s.updateRequest = request
	return s.updatedProject, s.updateErr
}

func (s *stubStore) RotatePublicKey(
	_ context.Context,
	ownerUserID string,
	projectID string,
	publicKey string,
) (Project, error) {
	s.rotateCalls++
	s.ownerUserID = ownerUserID
	s.projectID = projectID
	s.rotatedPublicKey = publicKey
	return s.rotatedProject, s.rotateErr
}

func boolPointer(value bool) *bool {
	return &value
}
