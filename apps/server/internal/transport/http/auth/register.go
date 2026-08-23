package auth

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	authdomain "github.com/liu04919/monitor-platform/apps/server/internal/auth"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/response"
)

func (h *Handler) Register(c *gin.Context) {
	request, ok := h.decodeCredentials(c)
	if !ok {
		return
	}

	user, err := h.service.Register(c.Request.Context(), request.Email, request.Password)
	if err != nil {
		writeRegisterError(c, err)
		return
	}

	writeUser(c, http.StatusCreated, user)
}

func writeRegisterError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, authdomain.ErrInvalidEmail):
		response.WriteError(c, http.StatusUnprocessableEntity, "INVALID_EMAIL", "email must be a valid address", &response.ErrorDetails{Field: "email"})
	case errors.Is(err, authdomain.ErrInvalidPassword):
		response.WriteError(c, http.StatusUnprocessableEntity, "INVALID_PASSWORD", "password must contain between 8 and 128 characters", &response.ErrorDetails{Field: "password"})
	case errors.Is(err, authdomain.ErrEmailConflict):
		response.WriteError(c, http.StatusConflict, "EMAIL_CONFLICT", "email is already registered", &response.ErrorDetails{Field: "email"})
	default:
		response.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not register user", nil)
	}
}
