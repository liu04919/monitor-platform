package ingestion

import (
	"context"
	"errors"
	"fmt"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

var (
	ErrInvalidPublicKey = errors.New("invalid public key")
	ErrBatchIDConflict  = errors.New("batch ID conflict")
)

// Result 表示 ingestion service 已经完成的持久化结果。
// 在 Key 校验、幂等判断和持久化真正成功之前，HTTP Handler 不能自行推断这些值。
type Result struct {
	Accepted  int
	Duplicate bool
}

// Service 负责 HTTP 请求完成解码和结构校验之后的业务流程。
type Service interface {
	Ingest(ctx context.Context, batch dto.TelemetryBatch) (Result, error)
}

// ProjectKeyVerifier 判断浏览器可见的 publicKey 是否允许向指定项目上报。
// Key 不存在、已禁用或与项目不匹配时，实现应返回 ErrInvalidPublicKey。
type ProjectKeyVerifier interface {
	Verify(ctx context.Context, appID, publicKey string) error
}

type BatchStoreResult struct {
	Duplicate bool
}

// BatchStore 负责批次的持久化和幂等判断。
// 相同 appID 和 batchID 对应不同请求内容时，实现应返回 ErrBatchIDConflict。
type BatchStore interface {
	Save(ctx context.Context, batch dto.TelemetryBatch) (BatchStoreResult, error)
}

type service struct {
	keyVerifier ProjectKeyVerifier
	batchStore  BatchStore
}

func NewService(keyVerifier ProjectKeyVerifier, batchStore BatchStore) Service {
	return &service{
		keyVerifier: keyVerifier,
		batchStore:  batchStore,
	}
}

func (s *service) Ingest(ctx context.Context, batch dto.TelemetryBatch) (Result, error) {
	if err := s.keyVerifier.Verify(ctx, batch.App.ID, batch.PublicKey); err != nil {
		return Result{}, fmt.Errorf("verify project key: %w", err)
	}

	storeResult, err := s.batchStore.Save(ctx, batch)
	if err != nil {
		return Result{}, fmt.Errorf("save telemetry batch: %w", err)
	}
	if storeResult.Duplicate {
		return Result{Duplicate: true}, nil
	}

	return Result{Accepted: len(batch.Events)}, nil
}
