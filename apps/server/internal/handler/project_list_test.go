package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
	"github.com/liu04919/monitor-platform/apps/server/internal/middleware"
	"github.com/liu04919/monitor-platform/apps/server/internal/project"
)

func TestProjectListHandlerReturnsProjectsWithoutPublicKey(t *testing.T) {
	createdAt := time.Date(2026, 8, 19, 1, 2, 3, 456_000_000, time.UTC)
	service := &stubProjectService{
		projects: []project.ProjectSummary{
			{ID: "project-1", Name: "项目一", Enabled: true, CreatedAt: createdAt},
			{ID: "project-2", Name: "项目二", Enabled: false, CreatedAt: createdAt.Add(time.Second)},
		},
	}

	recorder := performProjectListRequest(NewProjectHandler(service))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if service.calls != 1 {
		t.Fatalf("service calls = %d, want 1", service.calls)
	}
	if strings.Contains(recorder.Body.String(), "publicKey") || strings.Contains(recorder.Body.String(), "public_key") {
		t.Fatalf("response exposed public key field: %s", recorder.Body.String())
	}

	var response projectListEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Data.Projects) != 2 {
		t.Fatalf("projects = %#v", response.Data.Projects)
	}
	if response.Data.Projects[0].CreatedAt != createdAt.UnixMilli() {
		t.Fatalf("createdAt = %d", response.Data.Projects[0].CreatedAt)
	}
	if response.Data.Projects[1].Enabled {
		t.Fatal("disabled project was returned as enabled")
	}
}

func TestProjectListHandlerHidesServiceFailure(t *testing.T) {
	service := &stubProjectService{err: errors.New("postgres password leaked")}
	recorder := performProjectListRequest(NewProjectHandler(service))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	if strings.Contains(recorder.Body.String(), "password") {
		t.Fatalf("response exposed internal error: %s", recorder.Body.String())
	}
}

func performProjectListRequest(handler *ProjectHandler) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(middleware.SessionAuth(stubHandlerAuthenticator{}))
	engine.GET("/api/v1/projects", handler.List)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-token"})
	engine.ServeHTTP(recorder, request)
	return recorder
}

type stubProjectService struct {
	projects      []project.ProjectSummary
	err           error
	calls         int
	created       project.Project
	createErr     error
	createCalls   int
	createRequest project.CreateRequest
	ownerUserID   string
}

func (s *stubProjectService) List(_ context.Context, ownerUserID string) ([]project.ProjectSummary, error) {
	s.calls++
	s.ownerUserID = ownerUserID
	return s.projects, s.err
}

func (s *stubProjectService) Create(
	_ context.Context,
	ownerUserID string,
	request project.CreateRequest,
) (project.Project, error) {
	s.createCalls++
	s.ownerUserID = ownerUserID
	s.createRequest = request
	return s.created, s.createErr
}

type stubHandlerAuthenticator struct{}

func (stubHandlerAuthenticator) Authenticate(_ context.Context, _ string) (auth.User, error) {
	return auth.User{ID: "user-1", Email: "user@example.com"}, nil
}
