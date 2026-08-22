package issue

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
	"github.com/liu04919/monitor-platform/apps/server/internal/issuequery"
	"github.com/liu04919/monitor-platform/apps/server/internal/middleware"
)

func TestListReturnsIssueSummary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service := &stubService{page: issuequery.ListPage{
		Issues: []issuequery.Summary{{
			ID:            "issue-1",
			Title:         "profile failed",
			EventType:     "js_error",
			ExceptionType: "TypeError",
			EventCount:    3,
			AffectedUsers: 2,
			FirstSeen:     time.UnixMilli(1_000),
			LastSeen:      time.UnixMilli(2_000),
			LatestEventID: "event-3",
			LatestPageURL: "https://example.com/profile",
		}},
		NextCursor: "next",
	}}
	recorder := performListRequest(NewHandler(service), "/api/v1/projects/project-1/issues?limit=20")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var response listEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Data.Issues) != 1 || response.Data.Issues[0].EventCount != 3 {
		t.Fatalf("response = %#v", response)
	}
	if service.request.UserID != "user-1" || service.request.Limit != 20 {
		t.Fatalf("request = %#v", service.request)
	}
}

func TestListMapsErrors(t *testing.T) {
	tests := []struct {
		name       string
		serviceErr error
		url        string
		wantStatus int
		wantCode   string
	}{
		{name: "invalid limit", url: "/api/v1/projects/project-1/issues?limit=0", wantStatus: http.StatusBadRequest, wantCode: "INVALID_QUERY"},
		{name: "invalid cursor", serviceErr: issuequery.ErrInvalidCursor, url: "/api/v1/projects/project-1/issues", wantStatus: http.StatusBadRequest, wantCode: "INVALID_QUERY"},
		{name: "foreign project", serviceErr: issuequery.ErrProjectNotFound, url: "/api/v1/projects/project-1/issues", wantStatus: http.StatusNotFound, wantCode: "PROJECT_NOT_FOUND"},
		{name: "storage failure", serviceErr: errors.New("secret dsn"), url: "/api/v1/projects/project-1/issues", wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := performListRequest(NewHandler(&stubService{err: test.serviceErr}), test.url)

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			var response struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Error.Code != test.wantCode {
				t.Fatalf("code = %q, want %q", response.Error.Code, test.wantCode)
			}
		})
	}
}

func performListRequest(handler *Handler, url string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(middleware.SessionAuth(stubAuthenticator{}))
	engine.GET("/api/v1/projects/:projectId/issues", handler.List)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, url, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-token"})
	engine.ServeHTTP(recorder, request)
	return recorder
}

type stubAuthenticator struct{}

func (stubAuthenticator) Authenticate(_ context.Context, _ string) (auth.User, error) {
	return auth.User{ID: "user-1", Email: "user@example.com"}, nil
}

type stubService struct {
	page    issuequery.ListPage
	err     error
	request issuequery.ListRequest
}

func (s *stubService) List(_ context.Context, request issuequery.ListRequest) (issuequery.ListPage, error) {
	s.request = request
	return s.page, s.err
}
