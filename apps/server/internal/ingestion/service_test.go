package ingestion

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

func TestServiceIngestsNewBatchAfterKeyVerification(t *testing.T) {
	batch := ingestionBatch()
	order := []string{}
	verifier := &stubProjectKeyVerifier{order: &order}
	store := &stubBatchStore{order: &order}
	service := NewService(verifier, store)

	result, err := service.Ingest(context.Background(), batch)
	if err != nil {
		t.Fatalf("ingest batch: %v", err)
	}
	if result.Accepted != len(batch.Events) || result.Duplicate {
		t.Fatalf("unexpected ingestion result: %#v", result)
	}
	if verifier.calls != 1 || verifier.appID != batch.App.ID || verifier.publicKey != batch.PublicKey {
		t.Fatalf("unexpected key verification: %#v", verifier)
	}
	if store.calls != 1 || store.batch.BatchID != batch.BatchID {
		t.Fatalf("unexpected batch store call: %#v", store)
	}
	if !reflect.DeepEqual(order, []string{"verify", "save"}) {
		t.Fatalf("expected verify then save, got %v", order)
	}
}

func TestServiceReturnsDuplicateBatchResult(t *testing.T) {
	service := NewService(
		&stubProjectKeyVerifier{},
		&stubBatchStore{result: BatchStoreResult{Duplicate: true}},
	)

	result, err := service.Ingest(context.Background(), ingestionBatch())
	if err != nil {
		t.Fatalf("ingest duplicate batch: %v", err)
	}
	if result.Accepted != 0 || !result.Duplicate {
		t.Fatalf("unexpected duplicate result: %#v", result)
	}
}

func TestServiceStopsBeforeStorageWhenKeyVerificationFails(t *testing.T) {
	verifier := &stubProjectKeyVerifier{err: ErrInvalidPublicKey}
	store := &stubBatchStore{}
	service := NewService(verifier, store)

	_, err := service.Ingest(context.Background(), ingestionBatch())
	if !errors.Is(err, ErrInvalidPublicKey) {
		t.Fatalf("expected invalid public key error, got %v", err)
	}
	if store.calls != 0 {
		t.Fatalf("expected storage not to be called, got %d calls", store.calls)
	}
}

func TestServicePreservesDependencyErrors(t *testing.T) {
	lookupError := errors.New("project lookup failed")
	storeError := errors.New("database unavailable")

	tests := []struct {
		name       string
		verifier   *stubProjectKeyVerifier
		store      *stubBatchStore
		wantError  error
		storeCalls int
	}{
		{
			name:       "project lookup failure",
			verifier:   &stubProjectKeyVerifier{err: lookupError},
			store:      &stubBatchStore{},
			wantError:  lookupError,
			storeCalls: 0,
		},
		{
			name:       "batch ID conflict",
			verifier:   &stubProjectKeyVerifier{},
			store:      &stubBatchStore{err: ErrBatchIDConflict},
			wantError:  ErrBatchIDConflict,
			storeCalls: 1,
		},
		{
			name:       "storage failure",
			verifier:   &stubProjectKeyVerifier{},
			store:      &stubBatchStore{err: storeError},
			wantError:  storeError,
			storeCalls: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := NewService(test.verifier, test.store)

			_, err := service.Ingest(context.Background(), ingestionBatch())
			if !errors.Is(err, test.wantError) {
				t.Fatalf("expected error %v, got %v", test.wantError, err)
			}
			if test.store.calls != test.storeCalls {
				t.Fatalf("expected %d store calls, got %d", test.storeCalls, test.store.calls)
			}
		})
	}
}

type stubProjectKeyVerifier struct {
	err       error
	calls     int
	appID     string
	publicKey string
	order     *[]string
}

func (s *stubProjectKeyVerifier) Verify(
	_ context.Context,
	appID string,
	publicKey string,
) error {
	s.calls++
	s.appID = appID
	s.publicKey = publicKey
	if s.order != nil {
		*s.order = append(*s.order, "verify")
	}
	return s.err
}

type stubBatchStore struct {
	result BatchStoreResult
	err    error
	calls  int
	batch  dto.TelemetryBatch
	order  *[]string
}

func (s *stubBatchStore) Save(
	_ context.Context,
	batch dto.TelemetryBatch,
) (BatchStoreResult, error) {
	s.calls++
	s.batch = batch
	if s.order != nil {
		*s.order = append(*s.order, "save")
	}
	return s.result, s.err
}

func ingestionBatch() dto.TelemetryBatch {
	return dto.TelemetryBatch{
		BatchID:   "batch-1",
		PublicKey: "pk_monitor_web_demo",
		App: dto.App{
			ID: "7b5d9a2f-3c61-4e88-9f42-2d6b81a530c7",
		},
		Events: make([]dto.TelemetryEvent, 2),
	}
}
