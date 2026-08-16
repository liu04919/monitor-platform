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

// Result describes the durable outcome returned by the ingestion service.
// The HTTP handler must not infer these values before key checks, idempotency,
// and persistence have actually succeeded.
type Result struct {
	Accepted  int
	Duplicate bool
}

// Service owns the business work that begins after the HTTP request has been
// decoded and structurally validated.
type Service interface {
	Ingest(ctx context.Context, batch dto.TelemetryBatch) (Result, error)
}

// ProjectKeyVerifier checks whether a browser-visible public key may report to
// the requested app. Implementations return ErrInvalidPublicKey for unknown,
// disabled, or mismatched keys.
type ProjectKeyVerifier interface {
	Verify(ctx context.Context, appID, publicKey string) error
}

type BatchStoreResult struct {
	Duplicate bool
}

// BatchStore owns durable batch idempotency and persistence. Implementations
// return ErrBatchIDConflict when the same app ID and batch ID identify different
// request content.
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
