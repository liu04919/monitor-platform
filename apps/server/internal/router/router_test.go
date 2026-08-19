package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

const testManagementToken = "management-token-with-at-least-32-bytes"

func TestHealth(t *testing.T) {
	gin.SetMode(gin.TestMode)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	newTestRouter(&stubTelemetryHandler{}, &stubEventListHandler{}).ServeHTTP(recorder, request)

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

	newTestRouter(telemetryHandler, &stubEventListHandler{}).ServeHTTP(recorder, request)

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

	newTestRouter(telemetryHandler, &stubEventListHandler{}).ServeHTTP(recorder, request)

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

func TestManagementEventListRouteRequiresBearerToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	eventListHandler := &stubEventListHandler{}
	engine := newTestRouter(&stubTelemetryHandler{}, eventListHandler)

	unauthorized := httptest.NewRecorder()
	engine.ServeHTTP(
		unauthorized,
		httptest.NewRequest(http.MethodGet, "/api/v1/projects/project-1/events", nil),
	)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}
	if eventListHandler.calls != 0 {
		t.Fatalf("event list handler calls = %d, want 0", eventListHandler.calls)
	}

	authorized := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/project-1/events", nil)
	request.Header.Set("Authorization", "Bearer "+testManagementToken)
	engine.ServeHTTP(authorized, request)

	if authorized.Code != http.StatusOK {
		t.Fatalf("authorized status = %d, want %d", authorized.Code, http.StatusOK)
	}
	if eventListHandler.calls != 1 {
		t.Fatalf("event list handler calls = %d, want 1", eventListHandler.calls)
	}

	detailRecorder := httptest.NewRecorder()
	detailRequest := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/projects/project-1/events/event-1",
		nil,
	)
	detailRequest.Header.Set("Authorization", "Bearer "+testManagementToken)
	engine.ServeHTTP(detailRecorder, detailRequest)

	if detailRecorder.Code != http.StatusOK {
		t.Fatalf("detail status = %d, want %d", detailRecorder.Code, http.StatusOK)
	}
	if eventListHandler.detailCalls != 1 {
		t.Fatalf("event detail handler calls = %d, want 1", eventListHandler.detailCalls)
	}
}

func newTestRouter(
	telemetryHandler TelemetryBatchHandler,
	eventQueryHandler EventQueryHandler,
) *gin.Engine {
	return New(telemetryHandler, eventQueryHandler, testManagementToken)
}

type stubTelemetryHandler struct {
	calls int
}

func (h *stubTelemetryHandler) Batch(c *gin.Context) {
	h.calls++
	c.Status(http.StatusAccepted)
}

type stubEventListHandler struct {
	calls       int
	detailCalls int
}

func (h *stubEventListHandler) Detail(c *gin.Context) {
	h.detailCalls++
	c.Status(http.StatusOK)
}

func (h *stubEventListHandler) List(c *gin.Context) {
	h.calls++
	c.Status(http.StatusOK)
}
