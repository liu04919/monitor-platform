package auth

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	authdomain "github.com/liu04919/monitor-platform/apps/server/internal/auth"
	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
)

func (h *Handler) Login(c *gin.Context) {
	request, ok := h.decodeCredentials(c)
	if !ok {
		return
	}

	session, err := h.service.Login(c.Request.Context(), request.Email, request.Password)
	if err != nil {
		writeLoginError(c, err)
		return
	}

	h.setSessionCookie(c, session.Token)
	writeUser(c, http.StatusOK, session.User)
}

func writeLoginError(c *gin.Context, err error) {
	if errors.Is(err, authdomain.ErrInvalidCredentials) {
		httpapi.WriteError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "email or password is incorrect", nil)
		return
	}
	writeAuthenticationError(c, err)
}
