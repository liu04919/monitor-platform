package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

func TestSessionAuthStoresCurrentUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	authenticator := &stubSessionAuthenticator{user: auth.User{ID: "user-1"}}
	engine := gin.New()
	engine.Use(SessionAuth(authenticator))
	engine.GET("/protected", func(c *gin.Context) {
		user, ok := CurrentUser(c)
		if !ok {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.String(http.StatusOK, user.ID)
	})

	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-token"})
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK || recorder.Body.String() != "user-1" {
		t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
	}
	if authenticator.token != "session-token" {
		t.Fatalf("token = %q", authenticator.token)
	}
}

func TestSessionAuthMapsAuthenticationFailures(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "missing session", err: auth.ErrUnauthenticated, wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHENTICATED"},
		{name: "Redis unavailable", err: auth.ErrSessionUnavailable, wantStatus: http.StatusServiceUnavailable, wantCode: "SESSION_UNAVAILABLE"},
		{name: "internal", err: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			engine := gin.New()
			engine.Use(SessionAuth(&stubSessionAuthenticator{err: test.err}))
			engine.GET("/protected", func(c *gin.Context) { c.Status(http.StatusOK) })

			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/protected", nil))
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			if !strings.Contains(recorder.Body.String(), `"code":"`+test.wantCode+`"`) {
				t.Fatalf("body = %s", recorder.Body.String())
			}
		})
	}
}

type stubSessionAuthenticator struct {
	user  auth.User
	err   error
	token string
}

func (s *stubSessionAuthenticator) Authenticate(_ context.Context, token string) (auth.User, error) {
	s.token = token
	return s.user, s.err
}
