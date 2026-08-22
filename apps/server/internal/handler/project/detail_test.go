package project

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
	"github.com/liu04919/monitor-platform/apps/server/internal/middleware"
	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
)

func TestProjectDetailHandlerReturnsOwnedProjectWithPublicKey(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	createdAt := time.Date(2026, 8, 22, 1, 2, 3, 456_000_000, time.UTC)
	service := &stubService{foundProject: projectdomain.Project{
		ProjectSummary: projectdomain.ProjectSummary{
			ID:        projectID,
			Name:      "Monitor Web",
			Enabled:   true,
			CreatedAt: createdAt,
		},
		OwnerUserID: "user-1",
		PublicKey:   "pk_generated",
	}}

	recorder := performProjectDetailRequest(NewHandler(service), projectID)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if service.getCalls != 1 || service.ownerUserID != "user-1" || service.projectID != projectID {
		t.Fatalf("service get = calls %d, owner %q, project %q", service.getCalls, service.ownerUserID, service.projectID)
	}

	var response projectDetailEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.ID != projectID || response.Data.PublicKey != "pk_generated" || response.Data.CreatedAt != createdAt.UnixMilli() {
		t.Fatalf("response = %#v", response.Data)
	}
}

func TestProjectDetailHandlerMapsNotFoundAndInternalErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "missing or unowned", err: projectdomain.ErrProjectNotFound, wantStatus: http.StatusNotFound, wantCode: "PROJECT_NOT_FOUND"},
		{name: "internal", err: errors.New("postgres password leaked"), wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &stubService{getErr: test.err}
			recorder := performProjectDetailRequest(NewHandler(service), "11111111-1111-4111-8111-111111111111")
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			var response httpapi.ErrorEnvelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Error.Code != test.wantCode {
				t.Fatalf("code = %q, want %q", response.Error.Code, test.wantCode)
			}
			if strings.Contains(recorder.Body.String(), "password") {
				t.Fatalf("response exposed internal error: %s", recorder.Body.String())
			}
		})
	}
}

func performProjectDetailRequest(handler *Handler, projectID string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(middleware.SessionAuth(stubAuthenticator{}))
	engine.GET("/api/v1/projects/:projectId", handler.Detail)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-token"})
	engine.ServeHTTP(recorder, request)
	return recorder
}
