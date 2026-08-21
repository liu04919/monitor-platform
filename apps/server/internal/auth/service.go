// auth 包实现用户注册、登录和服务端 Session 生命周期。
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	minPasswordRunes = 8
	maxPasswordRunes = 128
)

var (
	ErrInvalidEmail       = errors.New("invalid email")
	ErrInvalidPassword    = errors.New("invalid password")
	ErrEmailConflict      = errors.New("email conflict")
	ErrUserNotFound       = errors.New("user not found")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUnauthenticated    = errors.New("unauthenticated")
	ErrSessionNotFound    = errors.New("session not found")
	ErrSessionUnavailable = errors.New("session store unavailable")
)

type User struct {
	ID           string
	Email        string
	PasswordHash string
	CreatedAt    time.Time
}

type UserStore interface {
	Create(ctx context.Context, user User) error
	FindByEmail(ctx context.Context, email string) (User, error)
	FindByID(ctx context.Context, id string) (User, error)
}

type SessionStore interface {
	Create(ctx context.Context, token, userID string, ttl time.Duration) error
	FindUserID(ctx context.Context, token string) (string, error)
	Delete(ctx context.Context, token string) error
}

type PasswordHasher interface {
	Hash(password string) (string, error)
	Matches(password, encodedHash string) (bool, error)
}

type TokenGenerator interface {
	Generate() (string, error)
}

type Session struct {
	Token string
	User  User
}

type Service struct {
	users      UserStore
	sessions   SessionStore
	passwords  PasswordHasher
	tokens     TokenGenerator
	sessionTTL time.Duration
	now        func() time.Time
}

func NewService(
	users UserStore,
	sessions SessionStore,
	passwords PasswordHasher,
	tokens TokenGenerator,
	sessionTTL time.Duration,
) *Service {
	return &Service{
		users:      users,
		sessions:   sessions,
		passwords:  passwords,
		tokens:     tokens,
		sessionTTL: sessionTTL,
		now:        time.Now,
	}
}

func (s *Service) Register(ctx context.Context, email, password string) (Session, error) {
	normalizedEmail, err := normalizeEmail(email)
	if err != nil {
		return Session{}, err
	}
	if err := validatePassword(password); err != nil {
		return Session{}, err
	}

	passwordHash, err := s.passwords.Hash(password)
	if err != nil {
		return Session{}, fmt.Errorf("hash password: %w", err)
	}

	user := User{
		ID:           uuid.NewString(),
		Email:        normalizedEmail,
		PasswordHash: passwordHash,
		CreatedAt:    s.now().UTC(),
	}
	if err := s.users.Create(ctx, user); err != nil {
		return Session{}, err
	}

	return s.createSession(ctx, user)
}

func (s *Service) Login(ctx context.Context, email, password string) (Session, error) {
	normalizedEmail, err := normalizeEmail(email)
	if err != nil || password == "" {
		return Session{}, ErrInvalidCredentials
	}

	user, err := s.users.FindByEmail(ctx, normalizedEmail)
	if errors.Is(err, ErrUserNotFound) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}

	matches, err := s.passwords.Matches(password, user.PasswordHash)
	if err != nil {
		return Session{}, fmt.Errorf("compare password: %w", err)
	}
	if !matches {
		return Session{}, ErrInvalidCredentials
	}

	return s.createSession(ctx, user)
}

func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrUnauthenticated
	}

	userID, err := s.sessions.FindUserID(ctx, token)
	if errors.Is(err, ErrSessionNotFound) {
		return User{}, ErrUnauthenticated
	}
	if err != nil {
		return User{}, errors.Join(ErrSessionUnavailable, err)
	}

	user, err := s.users.FindByID(ctx, userID)
	if errors.Is(err, ErrUserNotFound) {
		_ = s.sessions.Delete(ctx, token)
		return User{}, ErrUnauthenticated
	}
	if err != nil {
		return User{}, err
	}

	return user, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	if err := s.sessions.Delete(ctx, token); err != nil && !errors.Is(err, ErrSessionNotFound) {
		return errors.Join(ErrSessionUnavailable, err)
	}

	return nil
}

func (s *Service) createSession(ctx context.Context, user User) (Session, error) {
	token, err := s.tokens.Generate()
	if err != nil {
		return Session{}, fmt.Errorf("generate session token: %w", err)
	}
	if err := s.sessions.Create(ctx, token, user.ID, s.sessionTTL); err != nil {
		return Session{}, errors.Join(ErrSessionUnavailable, err)
	}

	return Session{Token: token, User: user}, nil
}

func normalizeEmail(value string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(value))
	if email == "" || len(email) > 254 {
		return "", ErrInvalidEmail
	}

	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email {
		return "", ErrInvalidEmail
	}

	return email, nil
}

func validatePassword(password string) error {
	length := utf8.RuneCountInString(password)
	if length < minPasswordRunes || length > maxPasswordRunes {
		return ErrInvalidPassword
	}

	return nil
}
