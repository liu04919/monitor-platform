package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRegisterCreatesNormalizedUserWithoutAccessingSessionStore(t *testing.T) {
	users := newFakeUserStore()
	sessions := &fakeSessionStore{createErr: errors.New("Redis must not be called")}
	service := NewService(
		users,
		sessions,
		fakePasswordHasher{},
		fakeTokenGenerator{err: errors.New("token generator must not be called")},
		24*time.Hour,
	)
	service.now = func() time.Time {
		return time.Date(2026, 8, 20, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	}

	created, err := service.Register(context.Background(), " User@Example.COM ", "password123")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if created.ID == "" || created.Email != "user@example.com" {
		t.Fatalf("Register() user = %#v", created)
	}
	if created.PasswordHash != "hashed:password123" {
		t.Fatalf("password hash = %q", created.PasswordHash)
	}
	if sessions.createdToken != "" || sessions.createdUserID != "" || sessions.createdTTL != 0 {
		t.Fatalf("registration unexpectedly accessed session store: %#v", sessions)
	}
	if created.CreatedAt.Location() != time.UTC {
		t.Fatalf("CreatedAt location = %v", created.CreatedAt.Location())
	}
}

func TestRegisterValidatesCredentials(t *testing.T) {
	tests := []struct {
		name     string
		email    string
		password string
		wantErr  error
	}{
		{name: "invalid email", email: "not-an-email", password: "password123", wantErr: ErrInvalidEmail},
		{name: "short password", email: "user@example.com", password: "short", wantErr: ErrInvalidPassword},
		{name: "long password", email: "user@example.com", password: string(make([]byte, 129)), wantErr: ErrInvalidPassword},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			users := newFakeUserStore()
			service := NewService(
				users,
				&fakeSessionStore{},
				fakePasswordHasher{},
				fakeTokenGenerator{token: "token"},
				time.Hour,
			)

			_, err := service.Register(context.Background(), test.email, test.password)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Register() error = %v, want %v", err, test.wantErr)
			}
			if len(users.byID) != 0 {
				t.Fatalf("users created = %d, want 0", len(users.byID))
			}
		})
	}
}

func TestLoginUsesGenericCredentialError(t *testing.T) {
	users := newFakeUserStore()
	users.seed(User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hashed:correct-password",
	})
	service := NewService(
		users,
		&fakeSessionStore{},
		fakePasswordHasher{},
		fakeTokenGenerator{token: "token"},
		time.Hour,
	)

	for _, credentials := range []struct {
		email    string
		password string
	}{
		{email: "missing@example.com", password: "correct-password"},
		{email: "user@example.com", password: "wrong-password"},
		{email: "invalid", password: "correct-password"},
	} {
		_, err := service.Login(context.Background(), credentials.email, credentials.password)
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("Login(%q) error = %v", credentials.email, err)
		}
	}
}

func TestLoginCreatesSession(t *testing.T) {
	users := newFakeUserStore()
	users.seed(User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hashed:correct-password",
	})
	sessions := &fakeSessionStore{}
	service := NewService(
		users,
		sessions,
		fakePasswordHasher{},
		fakeTokenGenerator{token: "login-token"},
		2*time.Hour,
	)

	result, err := service.Login(context.Background(), " USER@example.com ", "correct-password")
	if err != nil {
		t.Fatalf("Login() error = %v", err)
	}
	if result.User.ID != "user-1" || result.Token != "login-token" {
		t.Fatalf("Login() = %#v", result)
	}
	if sessions.createdTTL != 2*time.Hour {
		t.Fatalf("session TTL = %s", sessions.createdTTL)
	}
}

func TestAuthenticateAndLogout(t *testing.T) {
	users := newFakeUserStore()
	users.seed(User{ID: "user-1", Email: "user@example.com"})
	sessions := &fakeSessionStore{userID: "user-1"}
	service := NewService(
		users,
		sessions,
		fakePasswordHasher{},
		fakeTokenGenerator{},
		time.Hour,
	)

	user, err := service.Authenticate(context.Background(), "session-token")
	if err != nil || user.ID != "user-1" {
		t.Fatalf("Authenticate() = %#v, %v", user, err)
	}
	if err := service.Logout(context.Background(), "session-token"); err != nil {
		t.Fatalf("Logout() error = %v", err)
	}
	if sessions.deletedToken != "session-token" {
		t.Fatalf("deleted token = %q", sessions.deletedToken)
	}
}

func TestSessionFailuresAreDistinguishedFromMissingSessions(t *testing.T) {
	service := NewService(
		newFakeUserStore(),
		&fakeSessionStore{findErr: errors.New("redis unavailable")},
		fakePasswordHasher{},
		fakeTokenGenerator{},
		time.Hour,
	)

	_, err := service.Authenticate(context.Background(), "token")
	if !errors.Is(err, ErrSessionUnavailable) {
		t.Fatalf("Authenticate() error = %v", err)
	}

	service.sessions = &fakeSessionStore{findErr: ErrSessionNotFound}
	_, err = service.Authenticate(context.Background(), "token")
	if !errors.Is(err, ErrUnauthenticated) || errors.Is(err, ErrSessionUnavailable) {
		t.Fatalf("missing session error = %v", err)
	}
}

func TestLogoutReportsSessionStoreFailure(t *testing.T) {
	service := NewService(
		newFakeUserStore(),
		&fakeSessionStore{deleteErr: errors.New("redis unavailable")},
		fakePasswordHasher{},
		fakeTokenGenerator{},
		time.Hour,
	)

	err := service.Logout(context.Background(), "session-token")
	if !errors.Is(err, ErrSessionUnavailable) {
		t.Fatalf("Logout() error = %v, want ErrSessionUnavailable", err)
	}
}

type fakeUserStore struct {
	byID    map[string]User
	byEmail map[string]User
}

func newFakeUserStore() *fakeUserStore {
	return &fakeUserStore{byID: map[string]User{}, byEmail: map[string]User{}}
}

func (s *fakeUserStore) seed(user User) {
	s.byID[user.ID] = user
	s.byEmail[user.Email] = user
}

func (s *fakeUserStore) Create(_ context.Context, user User) error {
	if _, exists := s.byEmail[user.Email]; exists {
		return ErrEmailConflict
	}
	s.seed(user)
	return nil
}

func (s *fakeUserStore) FindByEmail(_ context.Context, email string) (User, error) {
	user, exists := s.byEmail[email]
	if !exists {
		return User{}, ErrUserNotFound
	}
	return user, nil
}

func (s *fakeUserStore) FindByID(_ context.Context, id string) (User, error) {
	user, exists := s.byID[id]
	if !exists {
		return User{}, ErrUserNotFound
	}
	return user, nil
}

type fakeSessionStore struct {
	createdToken  string
	createdUserID string
	createdTTL    time.Duration
	userID        string
	createErr     error
	findErr       error
	deleteErr     error
	deletedToken  string
}

func (s *fakeSessionStore) Create(_ context.Context, token, userID string, ttl time.Duration) error {
	s.createdToken = token
	s.createdUserID = userID
	s.createdTTL = ttl
	return s.createErr
}

func (s *fakeSessionStore) FindUserID(_ context.Context, _ string) (string, error) {
	return s.userID, s.findErr
}

func (s *fakeSessionStore) Delete(_ context.Context, token string) error {
	s.deletedToken = token
	return s.deleteErr
}

type fakePasswordHasher struct{}

func (fakePasswordHasher) Hash(password string) (string, error) {
	return "hashed:" + password, nil
}

func (fakePasswordHasher) Matches(password, encodedHash string) (bool, error) {
	return encodedHash == "hashed:"+password, nil
}

type fakeTokenGenerator struct {
	token string
	err   error
}

func (g fakeTokenGenerator) Generate() (string, error) {
	return g.token, g.err
}
