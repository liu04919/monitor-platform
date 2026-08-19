package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/eventquery"
)

func TestEventDetailHandlerReturnsStructuredJSON(t *testing.T) {
	timestamp := time.Date(2026, 8, 19, 12, 0, 0, 123_000_000, time.UTC)
	service := &stubEventListService{
		detail: eventquery.EventDetail{
			SchemaVersion: 2,
			ProjectID:     "project-1",
			AppName:       "Monitor Web",
			BatchID:       "batch-1",
			SendType:      dto.SendTypeFetch,
			SentAt:        timestamp.Add(-time.Second),
			EventID:       "event-1",
			Category:      dto.EventCategoryError,
			EventType:     "js_error",
			Timestamp:     timestamp,
			PageURL:       "https://example.com",
			Message:       "boom",
			Breadcrumbs:   json.RawMessage(`[{"category":"click"}]`),
			Payload:       json.RawMessage(`{"message":"boom"}`),
			ReceivedAt:    timestamp.Add(time.Second),
		},
	}
	recorder := performEventDetailRequest(
		NewEventListHandler(service),
		"/api/v1/projects/project-1/events/event-1",
	)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if service.detailCalls != 1 || service.detailRequest.ProjectID != "project-1" || service.detailRequest.EventID != "event-1" {
		t.Fatalf("detail request = %#v, calls = %d", service.detailRequest, service.detailCalls)
	}

	var response struct {
		Data struct {
			Payload     map[string]any `json:"payload"`
			Breadcrumbs []any          `json:"breadcrumbs"`
			Message     string         `json:"message"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v, body = %s", err, recorder.Body.String())
	}
	if response.Data.Message != "boom" || response.Data.Payload["message"] != "boom" || len(response.Data.Breadcrumbs) != 1 {
		t.Fatalf("structured JSON response = %#v", response.Data)
	}
}

func TestEventDetailHandlerMapsErrors(t *testing.T) {
	internalError := errors.New("clickhouse password leaked")
	tests := []struct {
		name          string
		err           error
		wantStatus    int
		wantCode      string
		wantField     string
		forbiddenText string
	}{
		{name: "invalid event ID", err: eventquery.ErrInvalidEventID, wantStatus: http.StatusBadRequest, wantCode: "INVALID_PATH", wantField: "eventId"},
		{name: "not found", err: eventquery.ErrEventNotFound, wantStatus: http.StatusNotFound, wantCode: "EVENT_NOT_FOUND"},
		{name: "storage failure", err: internalError, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR", forbiddenText: "password"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &stubEventListService{detailErr: test.err}
			recorder := performEventDetailRequest(
				NewEventListHandler(service),
				"/api/v1/projects/project-1/events/event-1",
			)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}

			var response errorEnvelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Error.Code != test.wantCode {
				t.Fatalf("code = %q, want %q", response.Error.Code, test.wantCode)
			}
			if test.wantField != "" && (response.Error.Details == nil || response.Error.Details.Field != test.wantField) {
				t.Fatalf("details = %#v, want field %q", response.Error.Details, test.wantField)
			}
			if test.forbiddenText != "" && strings.Contains(recorder.Body.String(), test.forbiddenText) {
				t.Fatalf("response exposed forbidden text: %s", recorder.Body.String())
			}
		})
	}
}

func performEventDetailRequest(handler *EventListHandler, url string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/api/v1/projects/:projectId/events/:eventId", handler.Detail)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, url, nil)
	engine.ServeHTTP(recorder, request)
	return recorder
}
