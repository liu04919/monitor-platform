package postgres

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/liu04919/monitor-platform/apps/server/internal/projectquery"
)

// ProjectReader 从 PostgreSQL 控制面读取管理端可见的项目。
type ProjectReader struct {
	db *gorm.DB
}

var _ projectquery.Store = (*ProjectReader)(nil)

func NewProjectReader(db *gorm.DB) *ProjectReader {
	return &ProjectReader{db: db}
}

func (r *ProjectReader) List(ctx context.Context) ([]projectquery.ProjectSummary, error) {
	var records []Project
	if err := r.db.WithContext(ctx).
		Select("id", "name", "enabled", "created_at").
		Order("created_at ASC").
		Order("id ASC").
		Find(&records).
		Error; err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}

	projects := make([]projectquery.ProjectSummary, 0, len(records))
	for _, record := range records {
		projects = append(projects, projectquery.ProjectSummary{
			ID:        record.ID,
			Name:      record.Name,
			Enabled:   record.Enabled,
			CreatedAt: record.CreatedAt,
		})
	}

	return projects, nil
}
