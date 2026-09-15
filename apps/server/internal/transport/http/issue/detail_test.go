package issue

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
	issuedomain "github.com/liu04919/monitor-platform/apps/server/internal/issue"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/middleware"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/response"
)

const handlerTestIssueID = "0123456789abcdef0123456789abcdef"

func TestDetailReturnsSummaryAndOccurrences(t *testing.T) {
	service := &stubService{detailPage: issuedomain.DetailPage{
		Issue: issuedomain.Summary{
			ID:            handlerTestIssueID,
			Title:         "profile failed",
			EventType:     "js_error",
			ExceptionType: "TypeError",
			EventCount:    3,
			AffectedUsers: 2,
			FirstSeen:     time.UnixMilli(1_000),
			LastSeen:      time.UnixMilli(2_000),
			LatestEventID: "event-3",
			LatestPageURL: "https://example.com/profile",
		},
		Occurrences: []issuedomain.Occurrence{{
			EventID:    "event-3",
			EventType:  "js_error",
			Timestamp:  time.UnixMilli(2_000),
			PageURL:    "https://example.com/profile",
			Message:    "profile failed",
			ReceivedAt: time.UnixMilli(2_100),
		}},
		NextCursor: "next",
	}}

	recorder := performDetailRequest(
		NewHandler(service),
		"/api/v1/projects/project-1/issues/"+handlerTestIssueID+"?limit=20&from=0&to=4102444800000",
	)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if service.detailRequest.UserID != "user-1" || service.detailRequest.IssueID != handlerTestIssueID || service.detailRequest.Limit != 20 {
		t.Fatalf("request = %#v", service.detailRequest)
	}
	if service.detailRequest.TimeRange != (telemetry.TimeRange{From: 0, To: 4102444800000}) {
		t.Fatalf("timeRange = %#v", service.detailRequest.TimeRange)
	}

	var response detailEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.Issue.EventCount != 3 || len(response.Data.Occurrences) != 1 || response.Data.NextCursor != "next" {
		t.Fatalf("response = %#v", response)
	}
}

func TestDetailMapsErrors(t *testing.T) {
	tests := []struct {
		name          string
		err           error
		url           string
		wantStatus    int
		wantCode      string
		wantField     string
		forbiddenText string
	}{
		{name: "invalid issue ID", err: issuedomain.ErrInvalidIssueID, url: "/api/v1/projects/project-1/issues/invalid?from=0&to=4102444800000", wantStatus: http.StatusBadRequest, wantCode: "INVALID_PATH", wantField: "issueId"},
		{name: "missing time", url: "/api/v1/projects/project-1/issues/" + handlerTestIssueID, wantStatus: http.StatusBadRequest, wantCode: "INVALID_QUERY", wantField: "timeRange"},
		{name: "invalid time", url: "/api/v1/projects/project-1/issues/" + handlerTestIssueID + "?from=100&to=10", wantStatus: http.StatusBadRequest, wantCode: "INVALID_QUERY", wantField: "timeRange"},
		{name: "invalid cursor", err: issuedomain.ErrInvalidCursor, url: "/api/v1/projects/project-1/issues/" + handlerTestIssueID + "?from=0&to=4102444800000", wantStatus: http.StatusBadRequest, wantCode: "INVALID_QUERY", wantField: "cursor"},
		{name: "missing issue", err: issuedomain.ErrIssueNotFound, url: "/api/v1/projects/project-1/issues/" + handlerTestIssueID + "?from=0&to=4102444800000", wantStatus: http.StatusNotFound, wantCode: "ISSUE_NOT_FOUND"},
		{name: "missing project", err: issuedomain.ErrProjectNotFound, url: "/api/v1/projects/project-1/issues/" + handlerTestIssueID + "?from=0&to=4102444800000", wantStatus: http.StatusNotFound, wantCode: "PROJECT_NOT_FOUND"},
		{name: "storage failure", err: errors.New("clickhouse password leaked"), url: "/api/v1/projects/project-1/issues/" + handlerTestIssueID + "?from=0&to=4102444800000", wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR", forbiddenText: "password"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := performDetailRequest(NewHandler(&stubService{detailErr: test.err}), test.url)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}

			var envelope response.ErrorEnvelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if envelope.Error.Code != test.wantCode {
				t.Fatalf("code = %q, want %q", envelope.Error.Code, test.wantCode)
			}
			if test.wantField != "" && (envelope.Error.Details == nil || envelope.Error.Details.Field != test.wantField) {
				t.Fatalf("details = %#v, want field %q", envelope.Error.Details, test.wantField)
			}
			if test.forbiddenText != "" && strings.Contains(recorder.Body.String(), test.forbiddenText) {
				t.Fatalf("response exposed forbidden text: %s", recorder.Body.String())
			}
		})
	}
}

func performDetailRequest(handler *Handler, url string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(middleware.SessionAuth(stubAuthenticator{}))
	engine.GET("/api/v1/projects/:projectId/issues/:issueId", handler.Detail)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, url, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-token"})
	engine.ServeHTTP(recorder, request)
	return recorder
}
