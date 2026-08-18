package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestHealth(t *testing.T) {
	gin.SetMode(gin.TestMode)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	New(&stubTelemetryHandler{}).ServeHTTP(recorder, request)

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

	New(telemetryHandler).ServeHTTP(recorder, request)

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

	New(telemetryHandler).ServeHTTP(recorder, request)

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

type stubTelemetryHandler struct {
	calls int
}

func (h *stubTelemetryHandler) Batch(c *gin.Context) {
	h.calls++
	c.Status(http.StatusAccepted)
}
