package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

const userEmailConstraint = "users_email_key"

type UserStore struct {
	db *gorm.DB
}

var _ auth.UserStore = (*UserStore)(nil)

func NewUserStore(db *gorm.DB) *UserStore {
	return &UserStore{db: db}
}

func (s *UserStore) Create(ctx context.Context, user auth.User) error {
	record := User{
		ID:           user.ID,
		Email:        user.Email,
		PasswordHash: user.PasswordHash,
		CreatedAt:    user.CreatedAt,
		UpdatedAt:    user.CreatedAt,
	}
	if err := s.db.WithContext(ctx).Create(&record).Error; err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) &&
			postgresError.Code == "23505" &&
			postgresError.ConstraintName == userEmailConstraint {
			return auth.ErrEmailConflict
		}

		return fmt.Errorf("insert user: %w", err)
	}

	return nil
}

func (s *UserStore) FindByEmail(ctx context.Context, email string) (auth.User, error) {
	return s.find(ctx, "email = ?", email)
}

func (s *UserStore) FindByID(ctx context.Context, id string) (auth.User, error) {
	return s.find(ctx, "id = ?", id)
}

func (s *UserStore) find(ctx context.Context, query string, value any) (auth.User, error) {
	var record User
	if err := s.db.WithContext(ctx).Where(query, value).Take(&record).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return auth.User{}, auth.ErrUserNotFound
		}
		return auth.User{}, fmt.Errorf("query user: %w", err)
	}

	return auth.User{
		ID:           record.ID,
		Email:        record.Email,
		PasswordHash: record.PasswordHash,
		CreatedAt:    record.CreatedAt,
	}, nil
}
