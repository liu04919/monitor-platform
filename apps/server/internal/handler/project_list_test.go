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

	"github.com/liu04919/monitor-platform/apps/server/internal/projectquery"
)

func TestProjectListHandlerReturnsProjectsWithoutPublicKey(t *testing.T) {
	createdAt := time.Date(2026, 8, 19, 1, 2, 3, 456_000_000, time.UTC)
	service := &stubProjectQueryService{
		projects: []projectquery.ProjectSummary{
			{ID: "project-1", Name: "项目一", Enabled: true, CreatedAt: createdAt},
			{ID: "project-2", Name: "项目二", Enabled: false, CreatedAt: createdAt.Add(time.Second)},
		},
	}

	recorder := performProjectListRequest(NewProjectListHandler(service))
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
	service := &stubProjectQueryService{err: errors.New("postgres password leaked")}
	recorder := performProjectListRequest(NewProjectListHandler(service))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	if strings.Contains(recorder.Body.String(), "password") {
		t.Fatalf("response exposed internal error: %s", recorder.Body.String())
	}
}

func performProjectListRequest(handler *ProjectListHandler) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/api/v1/projects", handler.List)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	engine.ServeHTTP(recorder, request)
	return recorder
}

type stubProjectQueryService struct {
	projects []projectquery.ProjectSummary
	err      error
	calls    int
}

func (s *stubProjectQueryService) List(_ context.Context) ([]projectquery.ProjectSummary, error) {
	s.calls++
	return s.projects, s.err
}
