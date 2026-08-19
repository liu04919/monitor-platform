package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestManagementAuth(t *testing.T) {
	const token = "management-token-with-at-least-32-bytes"

	tests := []struct {
		name          string
		authorization string
		wantStatus    int
		wantCalls     int
	}{
		{name: "missing header", wantStatus: http.StatusUnauthorized},
		{name: "wrong scheme", authorization: "Basic " + token, wantStatus: http.StatusUnauthorized},
		{name: "wrong token", authorization: "Bearer wrong-token", wantStatus: http.StatusUnauthorized},
		{name: "extra token segment", authorization: "Bearer " + token + " extra", wantStatus: http.StatusUnauthorized},
		{name: "valid token", authorization: "Bearer " + token, wantStatus: http.StatusNoContent, wantCalls: 1},
		{name: "case insensitive scheme", authorization: "bearer " + token, wantStatus: http.StatusNoContent, wantCalls: 1},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			calls := 0
			engine := gin.New()
			engine.Use(ManagementAuth(token))
			engine.GET("/events", func(c *gin.Context) {
				calls++
				c.Status(http.StatusNoContent)
			})

			request := httptest.NewRequest(http.MethodGet, "/events", nil)
			request.Header.Set("Authorization", test.authorization)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			if calls != test.wantCalls {
				t.Fatalf("handler calls = %d, want %d", calls, test.wantCalls)
			}
			if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", recorder.Header().Get("Cache-Control"))
			}
			if test.wantStatus == http.StatusUnauthorized && recorder.Header().Get("WWW-Authenticate") != "Bearer" {
				t.Fatalf("WWW-Authenticate = %q, want Bearer", recorder.Header().Get("WWW-Authenticate"))
			}
		})
	}
}
