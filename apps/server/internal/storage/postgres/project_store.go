package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
)

const projectPrimaryKeyConstraint = "projects_pkey"

// ProjectStore 在 PostgreSQL 控制面读取和创建管理端项目。
type ProjectStore struct {
	db *gorm.DB
}

var _ projectdomain.Store = (*ProjectStore)(nil)

func NewProjectStore(db *gorm.DB) *ProjectStore {
	return &ProjectStore{db: db}
}

func (s *ProjectStore) List(ctx context.Context, ownerUserID string) ([]projectdomain.ProjectSummary, error) {
	var records []Project
	if err := s.db.WithContext(ctx).
		Select("id", "name", "enabled", "created_at").
		Where("owner_user_id = ?", ownerUserID).
		Order("created_at ASC").
		Order("id ASC").
		Find(&records).
		Error; err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}

	projects := make([]projectdomain.ProjectSummary, 0, len(records))
	for _, record := range records {
		projects = append(projects, projectdomain.ProjectSummary{
			ID:        record.ID,
			Name:      record.Name,
			Enabled:   record.Enabled,
			CreatedAt: record.CreatedAt,
		})
	}

	return projects, nil
}

func (s *ProjectStore) Create(ctx context.Context, project projectdomain.Project) error {
	record := Project{
		ID:          project.ID,
		OwnerUserID: project.OwnerUserID,
		Name:        project.Name,
		PublicKey:   project.PublicKey,
		Enabled:     project.Enabled,
		CreatedAt:   project.CreatedAt,
		UpdatedAt:   project.CreatedAt,
	}
	if err := s.db.WithContext(ctx).Create(&record).Error; err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) &&
			postgresError.Code == "23505" &&
			postgresError.ConstraintName == projectPrimaryKeyConstraint {
			return projectdomain.ErrProjectIDCollision
		}

		return fmt.Errorf("insert project: %w", err)
	}

	return nil
}

func (s *ProjectStore) Owns(ctx context.Context, ownerUserID, projectID string) (bool, error) {
	var count int64
	if err := s.db.WithContext(ctx).
		Model(&Project{}).
		Where("id = ? AND owner_user_id = ?", projectID, ownerUserID).
		Count(&count).
		Error; err != nil {
		return false, fmt.Errorf("query project ownership: %w", err)
	}

	return count > 0, nil
}
