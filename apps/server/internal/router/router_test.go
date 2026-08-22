package router

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

const testSessionToken = "session-token"

func TestHealth(t *testing.T) {
	gin.SetMode(gin.TestMode)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	newTestRouter(&stubTelemetryHandler{}, &stubProjectHandler{}, &stubEventHandler{}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var response struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if response.Data.Status != "ok" {
		t.Fatalf("expected health status %q, got %q", "ok", response.Data.Status)
	}
}

func TestTelemetryRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)

	telemetryHandler := &stubTelemetryHandler{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/events/batch", nil)
	request.Header.Set("Origin", "http://localhost:5173")

	newTestRouter(telemetryHandler, &stubProjectHandler{}, &stubEventHandler{}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d", http.StatusAccepted, recorder.Code)
	}
	if telemetryHandler.calls != 1 {
		t.Fatalf("expected telemetry handler to be called once, got %d", telemetryHandler.calls)
	}
	if origin := recorder.Header().Get("Access-Control-Allow-Origin"); origin != "*" {
		t.Fatalf("expected wildcard CORS origin, got %q", origin)
	}
	if credentials := recorder.Header().Get("Access-Control-Allow-Credentials"); credentials != "" {
		t.Fatalf("expected credentials to remain disabled, got %q", credentials)
	}
}

func TestTelemetryPreflight(t *testing.T) {
	gin.SetMode(gin.TestMode)

	telemetryHandler := &stubTelemetryHandler{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/events/batch", nil)
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "content-type")

	newTestRouter(telemetryHandler, &stubProjectHandler{}, &stubEventHandler{}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected status %d, got %d", http.StatusNoContent, recorder.Code)
	}
	if telemetryHandler.calls != 0 {
		t.Fatalf("expected telemetry handler not to be called, got %d calls", telemetryHandler.calls)
	}
	if methods := recorder.Header().Get("Access-Control-Allow-Methods"); methods != "POST, OPTIONS" {
		t.Fatalf("unexpected allowed methods: %q", methods)
	}
	if headers := recorder.Header().Get("Access-Control-Allow-Headers"); headers != "Content-Type" {
		t.Fatalf("unexpected allowed headers: %q", headers)
	}
}

func TestAuthRoutes(t *testing.T) {
	authHandler := &stubAuthHandler{}
	engine := New(
		&stubTelemetryHandler{},
		&stubProjectHandler{},
		&stubEventHandler{},
		authHandler,
		stubSessionAuthenticator{},
	)

	tests := []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/v1/auth/register"},
		{method: http.MethodPost, path: "/api/v1/auth/login"},
		{method: http.MethodGet, path: "/api/v1/auth/me"},
		{method: http.MethodDelete, path: "/api/v1/auth/logout"},
	}

	for _, test := range tests {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("%s %s status = %d", test.method, test.path, recorder.Code)
		}
	}

	if authHandler.registerCalls != 1 || authHandler.loginCalls != 1 ||
		authHandler.meCalls != 1 || authHandler.logoutCalls != 1 {
		t.Fatalf("auth calls = %#v", authHandler)
	}
}

func TestEventRoutesRequireSessionCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)

	eventHandler := &stubEventHandler{}
	engine := newTestRouter(&stubTelemetryHandler{}, &stubProjectHandler{}, eventHandler)

	unauthorized := httptest.NewRecorder()
	engine.ServeHTTP(
		unauthorized,
		httptest.NewRequest(http.MethodGet, "/api/v1/projects/project-1/events", nil),
	)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}
	if eventHandler.calls != 0 {
		t.Fatalf("event list handler calls = %d, want 0", eventHandler.calls)
	}

	authorized := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/project-1/events", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: testSessionToken})
	engine.ServeHTTP(authorized, request)

	if authorized.Code != http.StatusOK {
		t.Fatalf("authorized status = %d, want %d", authorized.Code, http.StatusOK)
	}
	if eventHandler.calls != 1 {
		t.Fatalf("event list handler calls = %d, want 1", eventHandler.calls)
	}

	detailRecorder := httptest.NewRecorder()
	detailRequest := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/projects/project-1/events/event-1",
		nil,
	)
	detailRequest.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: testSessionToken})
	engine.ServeHTTP(detailRecorder, detailRequest)

	if detailRecorder.Code != http.StatusOK {
		t.Fatalf("detail status = %d, want %d", detailRecorder.Code, http.StatusOK)
	}
	if eventHandler.detailCalls != 1 {
		t.Fatalf("event detail handler calls = %d, want 1", eventHandler.detailCalls)
	}
}

func TestProjectRoutesRequireSessionCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)

	projectHandler := &stubProjectHandler{}
	engine := newTestRouter(&stubTelemetryHandler{}, projectHandler, &stubEventHandler{})

	unauthorized := httptest.NewRecorder()
	engine.ServeHTTP(
		unauthorized,
		httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil),
	)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}
	if projectHandler.calls != 0 {
		t.Fatalf("project list handler calls = %d, want 0", projectHandler.calls)
	}

	authorized := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: testSessionToken})
	engine.ServeHTTP(authorized, request)

	if authorized.Code != http.StatusOK {
		t.Fatalf("authorized status = %d, want %d", authorized.Code, http.StatusOK)
	}
	if projectHandler.calls != 1 {
		t.Fatalf("project list handler calls = %d, want 1", projectHandler.calls)
	}

	unauthorizedCreate := httptest.NewRecorder()
	engine.ServeHTTP(
		unauthorizedCreate,
		httptest.NewRequest(http.MethodPost, "/api/v1/projects", nil),
	)
	if unauthorizedCreate.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized create status = %d, want %d", unauthorizedCreate.Code, http.StatusUnauthorized)
	}
	if projectHandler.createCalls != 0 {
		t.Fatalf("project create handler calls = %d, want 0", projectHandler.createCalls)
	}

	authorizedCreate := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/projects", nil)
	createRequest.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: testSessionToken})
	engine.ServeHTTP(authorizedCreate, createRequest)
	if authorizedCreate.Code != http.StatusCreated {
		t.Fatalf("authorized create status = %d, want %d", authorizedCreate.Code, http.StatusCreated)
	}
	if projectHandler.createCalls != 1 {
		t.Fatalf("project create handler calls = %d, want 1", projectHandler.createCalls)
	}

	unauthorizedDetail := httptest.NewRecorder()
	engine.ServeHTTP(
		unauthorizedDetail,
		httptest.NewRequest(http.MethodGet, "/api/v1/projects/project-1", nil),
	)
	if unauthorizedDetail.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized detail status = %d, want %d", unauthorizedDetail.Code, http.StatusUnauthorized)
	}
	if projectHandler.detailCalls != 0 {
		t.Fatalf("project detail handler calls = %d, want 0", projectHandler.detailCalls)
	}

	authorizedDetail := httptest.NewRecorder()
	detailRequest := httptest.NewRequest(http.MethodGet, "/api/v1/projects/project-1", nil)
	detailRequest.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: testSessionToken})
	engine.ServeHTTP(authorizedDetail, detailRequest)
	if authorizedDetail.Code != http.StatusOK {
		t.Fatalf("authorized detail status = %d, want %d", authorizedDetail.Code, http.StatusOK)
	}
	if projectHandler.detailCalls != 1 {
		t.Fatalf("project detail handler calls = %d, want 1", projectHandler.detailCalls)
	}
}

func newTestRouter(
	telemetryHandler TelemetryBatchHandler,
	projectHandler ProjectHandler,
	eventQueryHandler EventQueryHandler,
) *gin.Engine {
	return New(
		telemetryHandler,
		projectHandler,
		eventQueryHandler,
		&stubAuthHandler{},
		stubSessionAuthenticator{},
	)
}

type stubSessionAuthenticator struct{}

func (stubSessionAuthenticator) Authenticate(_ context.Context, token string) (auth.User, error) {
	if token != testSessionToken {
		return auth.User{}, auth.ErrUnauthenticated
	}
	return auth.User{ID: "user-1", Email: "user@example.com"}, nil
}

type stubTelemetryHandler struct {
	calls int
}

func (h *stubTelemetryHandler) Batch(c *gin.Context) {
	h.calls++
	c.Status(http.StatusAccepted)
}

type stubEventHandler struct {
	calls       int
	detailCalls int
}

type stubProjectHandler struct {
	calls       int
	createCalls int
	detailCalls int
}

type stubAuthHandler struct {
	registerCalls int
	loginCalls    int
	meCalls       int
	logoutCalls   int
}

func (h *stubAuthHandler) Register(c *gin.Context) {
	h.registerCalls++
	c.Status(http.StatusNoContent)
}

func (h *stubAuthHandler) Login(c *gin.Context) {
	h.loginCalls++
	c.Status(http.StatusNoContent)
}

func (h *stubAuthHandler) Me(c *gin.Context) {
	h.meCalls++
	c.Status(http.StatusNoContent)
}

func (h *stubAuthHandler) Logout(c *gin.Context) {
	h.logoutCalls++
	c.Status(http.StatusNoContent)
}

func (h *stubProjectHandler) List(c *gin.Context) {
	h.calls++
	c.Status(http.StatusOK)
}

func (h *stubProjectHandler) Create(c *gin.Context) {
	h.createCalls++
	c.Status(http.StatusCreated)
}

func (h *stubProjectHandler) Detail(c *gin.Context) {
	h.detailCalls++
	c.Status(http.StatusOK)
}

func (h *stubEventHandler) Detail(c *gin.Context) {
	h.detailCalls++
	c.Status(http.StatusOK)
}

func (h *stubEventHandler) List(c *gin.Context) {
	h.calls++
	c.Status(http.StatusOK)
}
