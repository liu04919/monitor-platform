package auth

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	authdomain "github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

func (h *Handler) setSessionCookie(c *gin.Context, token string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     authdomain.SessionCookieName,
		Value:    token,
		Path:     "/api/v1",
		MaxAge:   int(h.sessionTTL.Seconds()),
		Expires:  time.Now().Add(h.sessionTTL),
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) clearSessionCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     authdomain.SessionCookieName,
		Path:     "/api/v1",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}
