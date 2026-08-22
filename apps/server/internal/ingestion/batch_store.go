package ingestion

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/issuefingerprint"
)

// BatchReservation 描述 PostgreSQL 批次账本需要持久化的业务身份。
type BatchReservation struct {
	ProjectID   string
	BatchID     string
	ContentHash string
	EventCount  int
}

// BatchReservationResult 表示批次账本中是否已经存在完成记录。
type BatchReservationResult struct {
	Duplicate bool
}

// BatchReceiptStore 负责批次身份、内容冲突和完成状态的持久化。
type BatchReceiptStore interface {
	Reserve(ctx context.Context, reservation BatchReservation) (BatchReservationResult, error)
	Complete(ctx context.Context, reservation BatchReservation) error
}

// EventWriter 负责把一个已经校验过的批次写入 ClickHouse。
type EventWriter interface {
	Write(ctx context.Context, batch dto.TelemetryBatch, deduplicationToken string) error
}

type persistentBatchStore struct {
	receipts BatchReceiptStore
	writer   EventWriter
}

// NewBatchStore 组合 PostgreSQL 批次账本和 ClickHouse 事件写入器。
func NewBatchStore(receipts BatchReceiptStore, writer EventWriter) BatchStore {
	return &persistentBatchStore{
		receipts: receipts,
		writer:   writer,
	}
}

func (s *persistentBatchStore) Save(
	ctx context.Context,
	batch dto.TelemetryBatch,
) (BatchStoreResult, error) {
	batch.Events = append([]dto.TelemetryEvent(nil), batch.Events...)
	for index := range batch.Events {
		fingerprint, err := issuefingerprint.Compute(batch.Events[index])
		if err != nil {
			return BatchStoreResult{}, fmt.Errorf("计算事件 %d Issue 指纹: %w", index, err)
		}
		batch.Events[index].IssueFingerprint = fingerprint
	}

	contentHash, err := batchContentHash(batch)
	if err != nil {
		return BatchStoreResult{}, fmt.Errorf("计算批次内容哈希: %w", err)
	}

	reservation := BatchReservation{
		ProjectID:   batch.App.ID,
		BatchID:     batch.BatchID,
		ContentHash: contentHash,
		EventCount:  len(batch.Events),
	}

	reservationResult, err := s.receipts.Reserve(ctx, reservation)
	if err != nil {
		return BatchStoreResult{}, fmt.Errorf("预留批次记录: %w", err)
	}
	if reservationResult.Duplicate {
		return BatchStoreResult{Duplicate: true}, nil
	}

	deduplicationToken := batchDeduplicationToken(reservation)
	if err := s.writer.Write(ctx, batch, deduplicationToken); err != nil {
		return BatchStoreResult{}, fmt.Errorf("写入 ClickHouse 事件: %w", err)
	}

	if err := s.receipts.Complete(ctx, reservation); err != nil {
		return BatchStoreResult{}, fmt.Errorf("完成批次记录: %w", err)
	}

	return BatchStoreResult{}, nil
}

func batchContentHash(batch dto.TelemetryBatch) (string, error) {
	// publicKey 和 sendType 分别属于鉴权与传输元数据，不应改变同一批次的业务内容身份。
	content := struct {
		SchemaVersion int                  `json:"schemaVersion"`
		BatchID       string               `json:"batchId"`
		SentAt        int64                `json:"sentAt"`
		App           dto.App              `json:"app"`
		Events        []dto.TelemetryEvent `json:"events"`
	}{
		SchemaVersion: batch.SchemaVersion,
		BatchID:       batch.BatchID,
		SentAt:        batch.SentAt,
		App:           batch.App,
		Events:        batch.Events,
	}

	encoded, err := json.Marshal(content)
	if err != nil {
		return "", err
	}

	sum := sha256.Sum256(encoded)

	return hex.EncodeToString(sum[:]), nil
}

func batchDeduplicationToken(reservation BatchReservation) string {
	value := reservation.ProjectID + "\x00" + reservation.BatchID + "\x00" + reservation.ContentHash
	sum := sha256.Sum256([]byte(value))

	return hex.EncodeToString(sum[:])
}
