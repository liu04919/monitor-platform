package ingestion

import (
	"context"
	"errors"
	"testing"

	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

func TestQueuedBatchStoreConfirmsPublicationBeforeSuccess(t *testing.T) {
	publishErr := errors.New("Kafka unavailable")
	for _, test := range []struct {
		name       string
		receipt    BatchReservationResult
		reserveErr error
		publishErr error
		wantErr    error
		published  bool
		duplicate  bool
	}{
		{name: "新批次", published: true},
		{name: "pending 批次仍须发布", receipt: BatchReservationResult{Existing: true}, published: true, duplicate: true},
		{name: "completed 批次无需发布", receipt: BatchReservationResult{Existing: true, Completed: true}, duplicate: true},
		{name: "冲突不发布", reserveErr: ErrBatchIDConflict, wantErr: ErrBatchIDConflict},
		{name: "发布失败不能返回成功", publishErr: publishErr, wantErr: publishErr, published: true},
		{name: "pending 发布失败也不能返回成功", receipt: BatchReservationResult{Existing: true}, publishErr: publishErr, wantErr: publishErr, published: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			receipts := &stubBatchReceiptStore{result: test.receipt, reserveErr: test.reserveErr}
			publisher := &stubBatchPublisher{err: test.publishErr}
			store := NewQueuedBatchStore(receipts, publisher)
			batch := persistentBatch()
			result, err := store.Save(context.Background(), batch)
			if !errors.Is(err, test.wantErr) || result.Duplicate != test.duplicate {
				t.Fatalf("Save() = %#v, %v", result, err)
			}
			if (publisher.calls == 1) != test.published || receipts.completeCalls != 0 {
				t.Fatalf("publish=%d complete=%d", publisher.calls, receipts.completeCalls)
			}
			if test.published && publisher.batch.BatchID != batch.BatchID {
				t.Fatal("发布时更换了批次身份")
			}
		})
	}
}

func TestQueuedAndPersistentStoresUseSameContentIdentity(t *testing.T) {
	receipts := &stubBatchReceiptStore{}
	batch := persistentBatch()
	if _, err := NewQueuedBatchStore(receipts, &stubBatchPublisher{}).Save(context.Background(), batch); err != nil {
		t.Fatal(err)
	}
	queuedHash := receipts.reservation.ContentHash
	if _, err := NewBatchStore(receipts, &stubEventWriter{}).Save(context.Background(), batch); err != nil {
		t.Fatal(err)
	}
	if receipts.reservation.ContentHash != queuedHash {
		t.Fatal("接收和入库生成了不同的批次身份")
	}
}

type stubBatchPublisher struct {
	err   error
	calls int
	batch telemetry.Batch
}

func (p *stubBatchPublisher) Publish(_ context.Context, batch telemetry.Batch) error {
	p.calls++
	p.batch = batch
	return p.err
}
