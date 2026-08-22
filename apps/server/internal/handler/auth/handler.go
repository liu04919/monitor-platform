package auth

import (
	"context"
	"time"

	authdomain "github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

const maxBodyBytes int64 = 4 << 10

type Service interface {
	Register(ctx context.Context, email, password string) (authdomain.User, error)
	Login(ctx context.Context, email, password string) (authdomain.Session, error)
	Authenticate(ctx context.Context, token string) (authdomain.User, error)
	Logout(ctx context.Context, token string) error
}

type Handler struct {
	service      Service
	sessionTTL   time.Duration
	cookieSecure bool
}

func NewHandler(service Service, sessionTTL time.Duration, cookieSecure bool) *Handler {
	return &Handler{
		service:      service,
		sessionTTL:   sessionTTL,
		cookieSecure: cookieSecure,
	}
}
