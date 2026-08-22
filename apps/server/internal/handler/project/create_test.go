package project

import (
	"bytes"
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

func TestProjectHandlerCreatesProject(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	createdAt := time.Date(2026, 8, 20, 1, 2, 3, 0, time.UTC)
	service := &stubService{
		created: projectdomain.Project{
			ProjectSummary: projectdomain.ProjectSummary{
				ID:        projectID,
				Name:      "Monitor Web",
				Enabled:   true,
				CreatedAt: createdAt,
			},
			PublicKey: "pk_generated",
		},
	}
	recorder := performProjectCreateRequest(
		NewHandler(service),
		`{"name":"Monitor Web"}`,
		"application/json; charset=utf-8",
	)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body = %s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
	if service.createCalls != 1 || service.createRequest.Name != "Monitor Web" {
		t.Fatalf("service create = calls %d, request %#v", service.createCalls, service.createRequest)
	}

	var response projectCreateEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.ID != projectID || response.Data.PublicKey != "pk_generated" {
		t.Fatalf("response = %#v", response.Data)
	}
}

func TestProjectHandlerRejectsInvalidRequestBody(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		contentType string
		wantStatus  int
		wantCode    string
	}{
		{name: "missing content type", body: `{}`, wantStatus: http.StatusUnsupportedMediaType, wantCode: "UNSUPPORTED_MEDIA_TYPE"},
		{name: "malformed JSON", body: `{`, contentType: "application/json", wantStatus: http.StatusBadRequest, wantCode: "MALFORMED_JSON"},
		{name: "caller supplied id", body: `{"id":"monitor","name":"Monitor"}`, contentType: "application/json", wantStatus: http.StatusBadRequest, wantCode: "MALFORMED_JSON"},
		{name: "unknown field", body: `{"name":"Monitor","extra":true}`, contentType: "application/json", wantStatus: http.StatusBadRequest, wantCode: "MALFORMED_JSON"},
		{name: "multiple JSON values", body: `{} {}`, contentType: "application/json", wantStatus: http.StatusBadRequest, wantCode: "MALFORMED_JSON"},
		{name: "body too large", body: `{"name":"` + strings.Repeat("a", int(maxProjectBodyBytes)) + `"}`, contentType: "application/json", wantStatus: http.StatusRequestEntityTooLarge, wantCode: "PAYLOAD_TOO_LARGE"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &stubService{}
			recorder := performProjectCreateRequest(NewHandler(service), test.body, test.contentType)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d, body = %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			var response httpapi.ErrorEnvelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Error.Code != test.wantCode {
				t.Fatalf("code = %q, want %q", response.Error.Code, test.wantCode)
			}
			if service.createCalls != 0 {
				t.Fatalf("service create calls = %d, want 0", service.createCalls)
			}
		})
	}
}

func TestProjectHandlerMapsCreateErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantField  string
	}{
		{name: "invalid name", err: projectdomain.ErrInvalidProjectName, wantStatus: http.StatusUnprocessableEntity, wantCode: "INVALID_PROJECT", wantField: "name"},
		{name: "generated id collision", err: projectdomain.ErrProjectIDCollision, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
		{name: "internal", err: errors.New("postgres password leaked"), wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &stubService{createErr: test.err}
			recorder := performProjectCreateRequest(
				NewHandler(service),
				`{"name":"Monitor Web"}`,
				"application/json",
			)
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
			if test.wantField != "" && (response.Error.Details == nil || response.Error.Details.Field != test.wantField) {
				t.Fatalf("details = %#v, want field %q", response.Error.Details, test.wantField)
			}
			if strings.Contains(recorder.Body.String(), "password") {
				t.Fatalf("response exposed internal error: %s", recorder.Body.String())
			}
		})
	}
}

func performProjectCreateRequest(handler *Handler, body, contentType string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(middleware.SessionAuth(stubAuthenticator{}))
	engine.POST("/api/v1/projects", handler.Create)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewBufferString(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-token"})
	engine.ServeHTTP(recorder, request)
	return recorder
}
