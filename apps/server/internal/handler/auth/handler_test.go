package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	authdomain "github.com/liu04919/monitor-platform/apps/server/internal/auth"
	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
)

func TestAuthHandlerRegistersWithoutCreatingSessionCookie(t *testing.T) {
	createdAt := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	service := &stubAuthService{registerUser: authdomain.User{
		ID:        "user-1",
		Email:     "user@example.com",
		CreatedAt: createdAt,
	}}
	handler := NewHandler(service, 24*time.Hour, true)
	recorder := performAuthRequest(
		http.MethodPost,
		"/api/v1/auth/register",
		`{"email":"user@example.com","password":"password123"}`,
		"application/json",
		handler.Register,
		"",
	)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if service.registerEmail != "user@example.com" || service.registerPassword != "password123" {
		t.Fatalf("register credentials = %q, %q", service.registerEmail, service.registerPassword)
	}

	cookies := recorder.Result().Cookies()
	if len(cookies) != 0 {
		t.Fatalf("registration unexpectedly set cookies: %#v", cookies)
	}

	var response userEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.ID != "user-1" || response.Data.CreatedAt != createdAt.UnixMilli() {
		t.Fatalf("response = %#v", response.Data)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", recorder.Header().Get("Cache-Control"))
	}
}

func TestAuthHandlerRejectsInvalidBodies(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		contentType string
		wantStatus  int
		wantCode    string
	}{
		{name: "missing content type", body: `{}`, wantStatus: http.StatusUnsupportedMediaType, wantCode: "UNSUPPORTED_MEDIA_TYPE"},
		{name: "malformed JSON", body: `{`, contentType: "application/json", wantStatus: http.StatusBadRequest, wantCode: "MALFORMED_JSON"},
		{name: "unknown field", body: `{"email":"user@example.com","password":"password123","role":"admin"}`, contentType: "application/json", wantStatus: http.StatusBadRequest, wantCode: "MALFORMED_JSON"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &stubAuthService{}
			handler := NewHandler(service, time.Hour, false)
			recorder := performAuthRequest(
				http.MethodPost,
				"/api/v1/auth/register",
				test.body,
				test.contentType,
				handler.Register,
				"",
			)

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			var response httpapi.ErrorEnvelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Error.Code != test.wantCode {
				t.Fatalf("code = %q", response.Error.Code)
			}
			if service.registerCalls != 0 {
				t.Fatalf("register calls = %d", service.registerCalls)
			}
		})
	}
}

func TestAuthHandlerMapsDomainErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "invalid email", err: authdomain.ErrInvalidEmail, wantStatus: http.StatusUnprocessableEntity, wantCode: "INVALID_EMAIL"},
		{name: "invalid password", err: authdomain.ErrInvalidPassword, wantStatus: http.StatusUnprocessableEntity, wantCode: "INVALID_PASSWORD"},
		{name: "email conflict", err: authdomain.ErrEmailConflict, wantStatus: http.StatusConflict, wantCode: "EMAIL_CONFLICT"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &stubAuthService{registerErr: test.err}
			handler := NewHandler(service, time.Hour, false)
			recorder := performAuthRequest(
				http.MethodPost,
				"/api/v1/auth/register",
				`{"email":"user@example.com","password":"password123"}`,
				"application/json",
				handler.Register,
				"",
			)
			assertAPIError(t, recorder, test.wantStatus, test.wantCode)
		})
	}
}

func TestAuthHandlerMeAndLogoutUseCookie(t *testing.T) {
	service := &stubAuthService{
		authenticatedUser: authdomain.User{ID: "user-1", Email: "user@example.com"},
	}
	handler := NewHandler(service, time.Hour, false)

	meRecorder := performAuthRequest(
		http.MethodGet,
		"/api/v1/auth/me",
		"",
		"",
		handler.Me,
		"session-token",
	)
	if meRecorder.Code != http.StatusOK || service.authToken != "session-token" {
		t.Fatalf("me status = %d, token = %q", meRecorder.Code, service.authToken)
	}

	logoutRecorder := performAuthRequest(
		http.MethodDelete,
		"/api/v1/auth/logout",
		"",
		"",
		handler.Logout,
		"session-token",
	)
	if logoutRecorder.Code != http.StatusNoContent || service.logoutToken != "session-token" {
		t.Fatalf("logout status = %d, token = %q", logoutRecorder.Code, service.logoutToken)
	}
	cookies := logoutRecorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].MaxAge != -1 {
		t.Fatalf("logout cookies = %#v", cookies)
	}
}

func TestAuthHandlerMeDistinguishesMissingAndUnavailableSession(t *testing.T) {
	tests := []struct {
		err        error
		wantStatus int
		wantCode   string
	}{
		{err: authdomain.ErrUnauthenticated, wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHENTICATED"},
		{err: authdomain.ErrSessionUnavailable, wantStatus: http.StatusServiceUnavailable, wantCode: "SESSION_UNAVAILABLE"},
	}

	for _, test := range tests {
		service := &stubAuthService{authenticateErr: test.err}
		handler := NewHandler(service, time.Hour, false)
		recorder := performAuthRequest(http.MethodGet, "/api/v1/auth/me", "", "", handler.Me, "token")
		assertAPIError(t, recorder, test.wantStatus, test.wantCode)
	}
}

func TestAuthHandlerLogoutDoesNotClearCookieWhenSessionRevocationFails(t *testing.T) {
	service := &stubAuthService{logoutErr: authdomain.ErrSessionUnavailable}
	handler := NewHandler(service, time.Hour, false)
	recorder := performAuthRequest(
		http.MethodDelete,
		"/api/v1/auth/logout",
		"",
		"",
		handler.Logout,
		"session-token",
	)

	assertAPIError(t, recorder, http.StatusServiceUnavailable, "SESSION_UNAVAILABLE")
	if service.logoutToken != "session-token" {
		t.Fatalf("logout token = %q", service.logoutToken)
	}
	if cookies := recorder.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("failed logout unexpectedly cleared cookie: %#v", cookies)
	}
}

func performAuthRequest(
	method string,
	path string,
	body string,
	contentType string,
	handler gin.HandlerFunc,
	token string,
) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Handle(method, path, handler)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		request.AddCookie(&http.Cookie{Name: authdomain.SessionCookieName, Value: token})
	}
	engine.ServeHTTP(recorder, request)
	return recorder
}

func assertAPIError(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("status = %d, want %d, body = %s", recorder.Code, status, recorder.Body.String())
	}
	var response httpapi.ErrorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Error.Code != code {
		t.Fatalf("code = %q, want %q", response.Error.Code, code)
	}
}

type stubAuthService struct {
	registerUser      authdomain.User
	registerErr       error
	registerCalls     int
	registerEmail     string
	registerPassword  string
	loginSession      authdomain.Session
	loginErr          error
	authenticatedUser authdomain.User
	authenticateErr   error
	authToken         string
	logoutErr         error
	logoutToken       string
}

func (s *stubAuthService) Register(_ context.Context, email, password string) (authdomain.User, error) {
	s.registerCalls++
	s.registerEmail = email
	s.registerPassword = password
	return s.registerUser, s.registerErr
}

func (s *stubAuthService) Login(_ context.Context, _, _ string) (authdomain.Session, error) {
	return s.loginSession, s.loginErr
}

func (s *stubAuthService) Authenticate(_ context.Context, token string) (authdomain.User, error) {
	s.authToken = token
	return s.authenticatedUser, s.authenticateErr
}

func (s *stubAuthService) Logout(_ context.Context, token string) error {
	s.logoutToken = token
	return s.logoutErr
}
