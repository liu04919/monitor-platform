package ingestion

import (
	"context"
	"fmt"

	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

// BatchPublisher 只有在消息系统确认接收后才返回 nil。
type BatchPublisher interface {
	Publish(ctx context.Context, batch telemetry.Batch) error
}

type queuedBatchStore struct {
	receipts  BatchReceiptStore
	publisher BatchPublisher
}

// NewQueuedBatchStore 保留 HTTP 层的批次冲突检查，把最终入库交给消费者。
func NewQueuedBatchStore(receipts BatchReceiptStore, publisher BatchPublisher) BatchStore {
	return &queuedBatchStore{receipts: receipts, publisher: publisher}
}

func (s *queuedBatchStore) Save(ctx context.Context, batch telemetry.Batch) (BatchStoreResult, error) {
	contentHash, err := batchContentHash(batch)
	if err != nil {
		return BatchStoreResult{}, fmt.Errorf("计算批次内容哈希: %w", err)
	}
	result, err := s.receipts.Reserve(ctx, BatchReservation{
		ProjectID: batch.App.ID, BatchID: batch.BatchID,
		ContentHash: contentHash, EventCount: len(batch.Events),
	})
	if err != nil {
		return BatchStoreResult{}, fmt.Errorf("预留批次记录: %w", err)
	}
	if result.Completed {
		return BatchStoreResult{Duplicate: true}, nil
	}

	// pending 可能来自上一次发布失败，不能直接返回成功。
	// 重复发布允许发生；消费端仍用批次账本和 ClickHouse token 防重。
	if err := s.publisher.Publish(ctx, batch); err != nil {
		return BatchStoreResult{}, fmt.Errorf("发布遥测批次: %w", err)
	}
	return BatchStoreResult{Duplicate: result.Existing}, nil
}
