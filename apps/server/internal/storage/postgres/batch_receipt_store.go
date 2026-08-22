package postgres

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
)

const (
	batchStatusPending   = "pending"
	batchStatusCompleted = "completed"
)

// IngestionBatch 是 PostgreSQL ingestion_batches 表对应的持久化模型。
type IngestionBatch struct {
	ProjectID   string    `gorm:"column:project_id;type:uuid;primaryKey"`
	BatchID     string    `gorm:"column:batch_id;type:varchar(128);primaryKey"`
	ContentHash string    `gorm:"column:content_hash;type:char(64);not null"`
	Status      string    `gorm:"column:status;type:varchar(16);not null"`
	EventCount  int       `gorm:"column:event_count;not null"`
	CreatedAt   time.Time `gorm:"column:created_at;not null"`
	UpdatedAt   time.Time `gorm:"column:updated_at;not null"`
}

func (IngestionBatch) TableName() string {
	return "ingestion_batches"
}

// BatchReceiptStore 使用 PostgreSQL 唯一键记录批次内容身份与完成状态。
type BatchReceiptStore struct {
	db *gorm.DB
}

var _ ingestion.BatchReceiptStore = (*BatchReceiptStore)(nil)

func NewBatchReceiptStore(db *gorm.DB) *BatchReceiptStore {
	return &BatchReceiptStore{db: db}
}

func (s *BatchReceiptStore) Reserve(
	ctx context.Context,
	reservation ingestion.BatchReservation,
) (ingestion.BatchReservationResult, error) {
	receipt := IngestionBatch{
		ProjectID:   reservation.ProjectID,
		BatchID:     reservation.BatchID,
		ContentHash: reservation.ContentHash,
		Status:      batchStatusPending,
		EventCount:  reservation.EventCount,
	}

	result := s.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&receipt)
	if result.Error != nil {
		return ingestion.BatchReservationResult{}, fmt.Errorf("创建批次记录: %w", result.Error)
	}
	if result.RowsAffected == 1 {
		return ingestion.BatchReservationResult{}, nil
	}

	var existing IngestionBatch
	if err := s.db.WithContext(ctx).
		Where("project_id = ? AND batch_id = ?", reservation.ProjectID, reservation.BatchID).
		Take(&existing).
		Error; err != nil {
		return ingestion.BatchReservationResult{}, fmt.Errorf("查询批次记录: %w", err)
	}

	if existing.ContentHash != reservation.ContentHash {
		return ingestion.BatchReservationResult{}, ingestion.ErrBatchIDConflict
	}

	switch existing.Status {
	case batchStatusPending:
		return ingestion.BatchReservationResult{}, nil
	case batchStatusCompleted:
		return ingestion.BatchReservationResult{Duplicate: true}, nil
	default:
		return ingestion.BatchReservationResult{}, fmt.Errorf("未知批次状态 %q", existing.Status)
	}
}

func (s *BatchReceiptStore) Complete(
	ctx context.Context,
	reservation ingestion.BatchReservation,
) error {
	result := s.db.WithContext(ctx).
		Model(&IngestionBatch{}).
		Where(
			"project_id = ? AND batch_id = ? AND content_hash = ?",
			reservation.ProjectID,
			reservation.BatchID,
			reservation.ContentHash,
		).
		Updates(map[string]any{
			"status":     batchStatusCompleted,
			"updated_at": time.Now().UTC(),
		})
	if result.Error != nil {
		return fmt.Errorf("更新批次状态: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("批次记录不存在或内容哈希不匹配")
	}

	return nil
}
