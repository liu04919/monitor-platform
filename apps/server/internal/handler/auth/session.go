package auth

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	authdomain "github.com/liu04919/monitor-platform/apps/server/internal/auth"
	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
)

func (h *Handler) Me(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	token, _ := c.Cookie(authdomain.SessionCookieName)
	user, err := h.service.Authenticate(c.Request.Context(), token)
	if err != nil {
		writeAuthenticationError(c, err)
		return
	}

	writeUser(c, http.StatusOK, user)
}

func (h *Handler) Logout(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	token, _ := c.Cookie(authdomain.SessionCookieName)
	if err := h.service.Logout(c.Request.Context(), token); err != nil {
		writeAuthenticationError(c, err)
		return
	}

	h.clearSessionCookie(c)
	c.Status(http.StatusNoContent)
}

func writeAuthenticationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, authdomain.ErrUnauthenticated):
		httpapi.WriteError(c, http.StatusUnauthorized, "UNAUTHENTICATED", "a valid login session is required", nil)
	case errors.Is(err, authdomain.ErrSessionUnavailable):
		httpapi.WriteError(c, http.StatusServiceUnavailable, "SESSION_UNAVAILABLE", "session service is temporarily unavailable", nil)
	default:
		httpapi.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not complete authentication", nil)
	}
}
