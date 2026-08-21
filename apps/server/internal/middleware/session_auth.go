package middleware

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

const currentUserContextKey = "currentUser"

type SessionAuthenticator interface {
	Authenticate(ctx context.Context, token string) (auth.User, error)
}

// SessionAuth 验证 HttpOnly Cookie，并把当前用户放入本次 Gin 请求上下文。
func SessionAuth(authenticator SessionAuthenticator) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		token, _ := c.Cookie(auth.SessionCookieName)
		user, err := authenticator.Authenticate(c.Request.Context(), token)
		if err != nil {
			writeSessionAuthError(c, err)
			return
		}

		c.Set(currentUserContextKey, user)
		c.Next()
	}
}

func CurrentUser(c *gin.Context) (auth.User, bool) {
	value, exists := c.Get(currentUserContextKey)
	if !exists {
		return auth.User{}, false
	}
	user, ok := value.(auth.User)
	return user, ok
}

func writeSessionAuthError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	code := "INTERNAL_ERROR"
	message := "server could not complete authentication"

	switch {
	case errors.Is(err, auth.ErrUnauthenticated):
		status = http.StatusUnauthorized
		code = "UNAUTHENTICATED"
		message = "a valid login session is required"
	case errors.Is(err, auth.ErrSessionUnavailable):
		status = http.StatusServiceUnavailable
		code = "SESSION_UNAVAILABLE"
		message = "session service is temporarily unavailable"
	}

	c.AbortWithStatusJSON(status, gin.H{
		"error": gin.H{"code": code, "message": message},
	})
}
