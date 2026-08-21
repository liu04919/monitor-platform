package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

const (
	maxAuthBodyBytes  int64 = 4 << 10
	sessionCookieName       = "monitor_session"
)

type AuthService interface {
	Register(ctx context.Context, email, password string) (auth.Session, error)
	Login(ctx context.Context, email, password string) (auth.Session, error)
	Authenticate(ctx context.Context, token string) (auth.User, error)
	Logout(ctx context.Context, token string) error
}

type AuthHandler struct {
	service      AuthService
	sessionTTL   time.Duration
	cookieSecure bool
}

func NewAuthHandler(service AuthService, sessionTTL time.Duration, cookieSecure bool) *AuthHandler {
	return &AuthHandler{
		service:      service,
		sessionTTL:   sessionTTL,
		cookieSecure: cookieSecure,
	}
}

func (h *AuthHandler) Register(c *gin.Context) {
	request, ok := h.decodeCredentials(c)
	if !ok {
		return
	}

	session, err := h.service.Register(c.Request.Context(), request.Email, request.Password)
	if err != nil {
		writeRegisterError(c, err)
		return
	}

	h.setSessionCookie(c, session.Token)
	writeAuthUser(c, http.StatusCreated, session.User)
}

func (h *AuthHandler) Login(c *gin.Context) {
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
	writeAuthUser(c, http.StatusOK, session.User)
}

func (h *AuthHandler) Me(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	token, _ := c.Cookie(sessionCookieName)
	user, err := h.service.Authenticate(c.Request.Context(), token)
	if err != nil {
		writeAuthenticationError(c, err)
		return
	}

	writeAuthUser(c, http.StatusOK, user)
}

func (h *AuthHandler) Logout(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	token, _ := c.Cookie(sessionCookieName)
	h.clearSessionCookie(c)
	if err := h.service.Logout(c.Request.Context(), token); err != nil {
		writeAuthenticationError(c, err)
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *AuthHandler) decodeCredentials(c *gin.Context) (authCredentialsRequest, bool) {
	c.Header("Cache-Control", "no-store")
	if !isJSONContentType(c.GetHeader("Content-Type")) {
		writeAPIError(
			c,
			http.StatusUnsupportedMediaType,
			"UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json",
			nil,
		)
		return authCredentialsRequest{}, false
	}

	var request authCredentialsRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAuthBodyBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeAuthDecodeError(c, err)
		return authCredentialsRequest{}, false
	}

	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("request body contains more than one JSON value")
		}
		writeAuthDecodeError(c, err)
		return authCredentialsRequest{}, false
	}

	return request, true
}

func (h *AuthHandler) setSessionCookie(c *gin.Context, token string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/api/v1",
		MaxAge:   int(h.sessionTTL.Seconds()),
		Expires:  time.Now().Add(h.sessionTTL),
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *AuthHandler) clearSessionCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     sessionCookieName,
		Path:     "/api/v1",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func writeRegisterError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, auth.ErrInvalidEmail):
		writeAPIError(c, http.StatusUnprocessableEntity, "INVALID_EMAIL", "email must be a valid address", &errorDetails{Field: "email"})
	case errors.Is(err, auth.ErrInvalidPassword):
		writeAPIError(c, http.StatusUnprocessableEntity, "INVALID_PASSWORD", "password must contain between 8 and 128 characters", &errorDetails{Field: "password"})
	case errors.Is(err, auth.ErrEmailConflict):
		writeAPIError(c, http.StatusConflict, "EMAIL_CONFLICT", "email is already registered", &errorDetails{Field: "email"})
	case errors.Is(err, auth.ErrSessionUnavailable):
		writeAPIError(c, http.StatusServiceUnavailable, "SESSION_UNAVAILABLE", "session service is temporarily unavailable", nil)
	default:
		writeAPIError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not register user", nil)
	}
}

func writeLoginError(c *gin.Context, err error) {
	if errors.Is(err, auth.ErrInvalidCredentials) {
		writeAPIError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "email or password is incorrect", nil)
		return
	}
	writeAuthenticationError(c, err)
}

func writeAuthenticationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthenticated):
		writeAPIError(c, http.StatusUnauthorized, "UNAUTHENTICATED", "a valid login session is required", nil)
	case errors.Is(err, auth.ErrSessionUnavailable):
		writeAPIError(c, http.StatusServiceUnavailable, "SESSION_UNAVAILABLE", "session service is temporarily unavailable", nil)
	default:
		writeAPIError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not complete authentication", nil)
	}
}

func writeAuthDecodeError(c *gin.Context, err error) {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		writeAPIError(c, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "request body must not exceed 4 KiB", nil)
		return
	}

	writeAPIError(c, http.StatusBadRequest, "MALFORMED_JSON", "request body must contain exactly one valid credentials JSON value", nil)
}

func writeAuthUser(c *gin.Context, status int, user auth.User) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, authUserEnvelope{Data: authUserData{
		ID:        user.ID,
		Email:     user.Email,
		CreatedAt: user.CreatedAt.UnixMilli(),
	}})
}

type authCredentialsRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authUserEnvelope struct {
	Data authUserData `json:"data"`
}

type authUserData struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	CreatedAt int64  `json:"createdAt"`
}
