package ingestion

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

func TestBatchStoreWritesAndCompletesNewBatch(t *testing.T) {
	receipts := &stubBatchReceiptStore{}
	writer := &stubEventWriter{}
	store := NewBatchStore(receipts, writer)
	batch := persistentBatch()

	result, err := store.Save(context.Background(), batch)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if result.Duplicate {
		t.Fatal("Save() Duplicate = true, want false")
	}
	if receipts.reserveCalls != 1 || receipts.completeCalls != 1 {
		t.Fatalf("receipt calls = reserve %d, complete %d, want 1, 1", receipts.reserveCalls, receipts.completeCalls)
	}
	if writer.calls != 1 || writer.token == "" {
		t.Fatalf("writer calls = %d, token = %q", writer.calls, writer.token)
	}
	if receipts.reservation.ContentHash == "" || receipts.reservation.EventCount != len(batch.Events) {
		t.Fatalf("unexpected reservation: %#v", receipts.reservation)
	}
}

func TestBatchStoreReturnsCompletedBatchAsDuplicate(t *testing.T) {
	receipts := &stubBatchReceiptStore{
		result: BatchReservationResult{Duplicate: true},
	}
	writer := &stubEventWriter{}
	store := NewBatchStore(receipts, writer)

	result, err := store.Save(context.Background(), persistentBatch())
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if !result.Duplicate {
		t.Fatal("Save() Duplicate = false, want true")
	}
	if writer.calls != 0 || receipts.completeCalls != 0 {
		t.Fatalf("duplicate batch reached writer or completion: writer=%d complete=%d", writer.calls, receipts.completeCalls)
	}
}

func TestBatchStoreLeavesPendingReceiptWhenEventWriteFails(t *testing.T) {
	writeError := errors.New("ClickHouse unavailable")
	receipts := &stubBatchReceiptStore{}
	writer := &stubEventWriter{err: writeError}
	store := NewBatchStore(receipts, writer)

	_, err := store.Save(context.Background(), persistentBatch())
	if !errors.Is(err, writeError) {
		t.Fatalf("Save() error = %v, want %v", err, writeError)
	}
	if receipts.completeCalls != 0 {
		t.Fatalf("complete calls = %d, want 0", receipts.completeCalls)
	}
}

func TestBatchStorePreservesReceiptErrors(t *testing.T) {
	reserveError := errors.New("reserve failed")
	completeError := errors.New("complete failed")

	tests := []struct {
		name       string
		receipts   *stubBatchReceiptStore
		wantError  error
		writeCalls int
	}{
		{
			name:       "reserve",
			receipts:   &stubBatchReceiptStore{reserveErr: reserveError},
			wantError:  reserveError,
			writeCalls: 0,
		},
		{
			name:       "complete",
			receipts:   &stubBatchReceiptStore{completeErr: completeError},
			wantError:  completeError,
			writeCalls: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			writer := &stubEventWriter{}
			store := NewBatchStore(test.receipts, writer)

			_, err := store.Save(context.Background(), persistentBatch())
			if !errors.Is(err, test.wantError) {
				t.Fatalf("Save() error = %v, want %v", err, test.wantError)
			}
			if writer.calls != test.writeCalls {
				t.Fatalf("writer calls = %d, want %d", writer.calls, test.writeCalls)
			}
		})
	}
}

func TestBatchContentHashIgnoresAuthenticationAndTransportMetadata(t *testing.T) {
	first := persistentBatch()
	second := first
	second.PublicKey = "rotated-public-key"
	second.SendType = dto.SendTypeBeacon

	firstHash, err := batchContentHash(first)
	if err != nil {
		t.Fatalf("batchContentHash(first) error = %v", err)
	}
	secondHash, err := batchContentHash(second)
	if err != nil {
		t.Fatalf("batchContentHash(second) error = %v", err)
	}
	if firstHash != secondHash {
		t.Fatalf("hashes differ: %q != %q", firstHash, secondHash)
	}
}

type stubBatchReceiptStore struct {
	result        BatchReservationResult
	reserveErr    error
	completeErr   error
	reservation   BatchReservation
	reserveCalls  int
	completeCalls int
}

func (s *stubBatchReceiptStore) Reserve(
	_ context.Context,
	reservation BatchReservation,
) (BatchReservationResult, error) {
	s.reserveCalls++
	s.reservation = reservation

	return s.result, s.reserveErr
}

func (s *stubBatchReceiptStore) Complete(
	_ context.Context,
	reservation BatchReservation,
) error {
	s.completeCalls++
	s.reservation = reservation

	return s.completeErr
}

type stubEventWriter struct {
	err   error
	calls int
	batch dto.TelemetryBatch
	token string
}

func (s *stubEventWriter) Write(
	_ context.Context,
	batch dto.TelemetryBatch,
	token string,
) error {
	s.calls++
	s.batch = batch
	s.token = token

	return s.err
}

func persistentBatch() dto.TelemetryBatch {
	level := dto.EventLevelError

	return dto.TelemetryBatch{
		SchemaVersion: 2,
		BatchID:       "batch-1",
		SentAt:        1_700_000_000_000,
		PublicKey:     "pk_monitor_web_demo",
		App: dto.App{
			ID:   "monitor-web",
			Name: "Monitor Web",
		},
		Events: []dto.TelemetryEvent{
			{
				SchemaVersion: 2,
				EventID:       "event-1",
				Category:      dto.EventCategoryError,
				EventType:     "exception",
				Timestamp:     1_700_000_000_000,
				PageURL:       "https://example.com",
				Level:         &level,
				Breadcrumbs:   []dto.Breadcrumb{},
				Payload:       json.RawMessage(`{"message":"boom"}`),
			},
		},
		SendType: dto.SendTypeFetch,
	}
}
