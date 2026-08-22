package event

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
	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/eventquery"
	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
	"github.com/liu04919/monitor-platform/apps/server/internal/middleware"
)

func TestEventHandlerReturnsPage(t *testing.T) {
	userID := "user-1"
	level := dto.EventLevelError
	timestamp := time.Date(2026, 8, 19, 1, 2, 3, 456_000_000, time.UTC)
	service := &stubService{
		page: eventquery.ListPage{
			Events: []eventquery.EventSummary{
				{
					BatchID:    "batch-1",
					SendType:   dto.SendTypeBeacon,
					EventID:    "event-1",
					Category:   dto.EventCategoryError,
					EventType:  "js_error",
					Timestamp:  timestamp,
					PageURL:    "https://example.com/page",
					UserID:     &userID,
					Level:      &level,
					Message:    "boom",
					ReceivedAt: timestamp.Add(time.Second),
				},
			},
			NextCursor: "next-cursor",
		},
	}

	recorder := performEventListRequest(
		NewHandler(service),
		"/api/v1/projects/project-1/events?category=error&eventType=js_error&limit=20&cursor=current-cursor",
	)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if service.calls != 1 {
		t.Fatalf("service calls = %d, want 1", service.calls)
	}
	if service.request.ProjectID != "project-1" ||
		service.request.Category != dto.EventCategoryError ||
		service.request.EventType != "js_error" ||
		service.request.Limit != 20 ||
		service.request.Cursor != "current-cursor" {
		t.Fatalf("request = %#v", service.request)
	}

	var response eventListEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Data.Events) != 1 || response.Data.Events[0].EventID != "event-1" {
		t.Fatalf("events = %#v", response.Data.Events)
	}
	if response.Data.Events[0].Timestamp != timestamp.UnixMilli() || response.Data.Events[0].ReceivedAt != timestamp.Add(time.Second).UnixMilli() {
		t.Fatalf("event timestamps = %#v", response.Data.Events[0])
	}
	if response.Data.NextCursor != "next-cursor" {
		t.Fatalf("nextCursor = %q", response.Data.NextCursor)
	}
}

func TestEventHandlerMapsListErrors(t *testing.T) {
	internalError := errors.New("clickhouse password leaked")
	tests := []struct {
		name          string
		url           string
		serviceError  error
		wantStatus    int
		wantCode      string
		wantField     string
		wantCalls     int
		forbiddenText string
	}{
		{name: "limit syntax", url: "/api/v1/projects/project-1/events?limit=abc", wantStatus: http.StatusBadRequest, wantCode: "INVALID_QUERY", wantField: "limit"},
		{name: "invalid category", url: "/api/v1/projects/project-1/events", serviceError: eventquery.ErrInvalidCategory, wantStatus: http.StatusBadRequest, wantCode: "INVALID_QUERY", wantField: "category", wantCalls: 1},
		{name: "invalid cursor", url: "/api/v1/projects/project-1/events", serviceError: eventquery.ErrInvalidCursor, wantStatus: http.StatusBadRequest, wantCode: "INVALID_QUERY", wantField: "cursor", wantCalls: 1},
		{name: "project not found", url: "/api/v1/projects/project-1/events", serviceError: eventquery.ErrProjectNotFound, wantStatus: http.StatusNotFound, wantCode: "PROJECT_NOT_FOUND", wantCalls: 1},
		{name: "storage failure", url: "/api/v1/projects/project-1/events", serviceError: internalError, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR", wantCalls: 1, forbiddenText: "password"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &stubService{err: test.serviceError}
			recorder := performEventListRequest(NewHandler(service), test.url)

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			if service.calls != test.wantCalls {
				t.Fatalf("service calls = %d, want %d", service.calls, test.wantCalls)
			}

			var response httpapi.ErrorEnvelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Error.Code != test.wantCode {
				t.Fatalf("error code = %q, want %q", response.Error.Code, test.wantCode)
			}
			if test.wantField != "" && (response.Error.Details == nil || response.Error.Details.Field != test.wantField) {
				t.Fatalf("error details = %#v, want field %q", response.Error.Details, test.wantField)
			}
			if test.forbiddenText != "" && strings.Contains(recorder.Body.String(), test.forbiddenText) {
				t.Fatalf("response exposed forbidden text: %s", recorder.Body.String())
			}
		})
	}
}

func performEventListRequest(handler *Handler, url string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(middleware.SessionAuth(stubAuthenticator{}))
	engine.GET("/api/v1/projects/:projectId/events", handler.List)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, url, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-token"})
	engine.ServeHTTP(recorder, request)
	return recorder
}
