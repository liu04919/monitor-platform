// devseed 包负责创建本地开发环境使用的固定接入项目。
package devseed

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	postgresstore "github.com/liu04919/monitor-platform/apps/server/internal/storage/postgres"
)

const (
	DefaultProjectID   = "monitor-local"
	DefaultProjectName = "monitor"
	DefaultPublicKey   = "pk_local_development"
)

type Project struct {
	ID        string
	Name      string
	PublicKey string
}

// UpsertProject 创建或更新一个启用状态的本地开发项目。
// 它只处理数据，不负责创建表；调用前必须先执行数据库迁移。
func UpsertProject(ctx context.Context, db *gorm.DB, project Project) error {
	project.ID = strings.TrimSpace(project.ID)
	project.Name = strings.TrimSpace(project.Name)
	project.PublicKey = strings.TrimSpace(project.PublicKey)

	if project.ID == "" {
		return fmt.Errorf("本地项目 ID 不能为空")
	}
	if project.Name == "" {
		return fmt.Errorf("本地项目名称不能为空")
	}
	if project.PublicKey == "" {
		return fmt.Errorf("本地项目 publicKey 不能为空")
	}

	now := time.Now().UTC()
	record := postgresstore.Project{
		ID:        project.ID,
		Name:      project.Name,
		PublicKey: project.PublicKey,
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"name":       record.Name,
				"public_key": record.PublicKey,
				"enabled":    true,
				"updated_at": now,
			}),
		}).
		Create(&record).
		Error; err != nil {
		return fmt.Errorf("写入本地开发项目: %w", err)
	}

	return nil
}
