package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
)

// ProjectKeyVerifier 使用 PostgreSQL 中的 projects 表校验项目公开上报 Key。
// publicKey 是浏览器可见的接入凭证，不是管理端 Secret。
type ProjectKeyVerifier struct {
	db *gorm.DB
}

var _ ingestion.ProjectKeyVerifier = (*ProjectKeyVerifier)(nil)

func NewProjectKeyVerifier(db *gorm.DB) *ProjectKeyVerifier {
	return &ProjectKeyVerifier{db: db}
}

func (v *ProjectKeyVerifier) Verify(ctx context.Context, appID, publicKey string) error {
	if uuid.Validate(appID) != nil {
		return ingestion.ErrInvalidPublicKey
	}

	var project Project

	err := v.db.WithContext(ctx).
		Select("id").
		Where("id = ? AND public_key = ? AND enabled = ?", appID, publicKey, true).
		Take(&project).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ingestion.ErrInvalidPublicKey
	}
	if err != nil {
		return fmt.Errorf("query project public key: %w", err)
	}

	return nil
}
