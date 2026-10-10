package kafka

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"

	kafkaclient "github.com/segmentio/kafka-go"

	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

func TestConsumerRetriesWriteAndCommitBeforeNextMessage(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var order []string
	reader := &stubReader{messages: []kafkaclient.Message{testMessage(t, "one", 10), testMessage(t, "two", 11)}, cancel: cancel}
	store := batchStoreFunc(func(_ context.Context, batch telemetry.Batch) (ingestion.BatchStoreResult, error) {
		order = append(order, "save:"+batch.BatchID)
		if len(order) == 1 {
			return ingestion.BatchStoreResult{}, errors.New("ClickHouse temporarily unavailable")
		}
		return ingestion.BatchStoreResult{}, nil
	})
	reader.commit = func(message kafkaclient.Message) error {
		order = append(order, fmt.Sprintf("commit:%d", message.Offset))
		if len(order) == 3 {
			return errors.New("commit failed")
		}
		return nil
	}
	consumer := &Consumer{reader: reader, store: store}
	if err := consumer.Run(ctx); err != nil {
		t.Fatal(err)
	}
	want := []string{"save:one", "save:one", "commit:10", "commit:10", "save:two", "commit:11"}
	if !reflect.DeepEqual(order, want) {
		t.Fatalf("处理顺序 = %v, want %v", order, want)
	}
}

func TestConsumerDoesNotCommitInvalidOrConflictingMessages(t *testing.T) {
	for _, test := range []struct {
		name    string
		value   []byte
		saveErr error
	}{
		{name: "非法 JSON", value: []byte("{")},
		{name: "非法协议", value: []byte(`{"schemaVersion":1}`)},
		{name: "批次冲突", value: testMessage(t, "conflict", 1).Value, saveErr: ingestion.ErrBatchIDConflict},
	} {
		t.Run(test.name, func(t *testing.T) {
			committed := false
			consumer := &Consumer{
				reader: &stubReader{commit: func(kafkaclient.Message) error { committed = true; return nil }},
				store: batchStoreFunc(func(context.Context, telemetry.Batch) (ingestion.BatchStoreResult, error) {
					return ingestion.BatchStoreResult{}, test.saveErr
				}),
			}
			if err := consumer.process(context.Background(), kafkaclient.Message{Value: test.value}); err == nil || committed {
				t.Fatalf("error=%v committed=%v", err, committed)
			}
		})
	}
}

func TestConsumerCancellationLeavesFailedMessageUncommitted(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	committed := false
	consumer := &Consumer{
		reader: &stubReader{commit: func(kafkaclient.Message) error { committed = true; return nil }},
		store: batchStoreFunc(func(context.Context, telemetry.Batch) (ingestion.BatchStoreResult, error) {
			cancel()
			return ingestion.BatchStoreResult{}, context.Canceled
		}),
	}
	if err := consumer.process(ctx, testMessage(t, "cancelled", 1)); !errors.Is(err, context.Canceled) || committed {
		t.Fatalf("error=%v committed=%v", err, committed)
	}
}

type batchStoreFunc func(context.Context, telemetry.Batch) (ingestion.BatchStoreResult, error)

func (f batchStoreFunc) Save(ctx context.Context, batch telemetry.Batch) (ingestion.BatchStoreResult, error) {
	return f(ctx, batch)
}

type stubReader struct {
	messages []kafkaclient.Message
	commit   func(kafkaclient.Message) error
	cancel   context.CancelFunc
}

func (r *stubReader) FetchMessage(ctx context.Context) (kafkaclient.Message, error) {
	if len(r.messages) == 0 {
		r.cancel()
		return kafkaclient.Message{}, ctx.Err()
	}
	message := r.messages[0]
	r.messages = r.messages[1:]
	return message, nil
}
func (r *stubReader) CommitMessages(_ context.Context, messages ...kafkaclient.Message) error {
	return r.commit(messages[0])
}
func (r *stubReader) Close() error { return nil }

func testMessage(t *testing.T, id string, offset int64) kafkaclient.Message {
	t.Helper()
	batch := telemetry.Batch{
		SchemaVersion: 2, BatchID: id, SentAt: 1_700_000_000_000,
		PublicKey: "pk_test", App: telemetry.App{ID: "7b5d9a2f-3c61-4e88-9f42-2d6b81a530c7", Name: "Kafka 测试"},
		SendType: telemetry.SendTypeFetch,
		Events: []telemetry.Event{{
			SchemaVersion: 2, EventID: id, Category: telemetry.CategoryPerformance,
			EventType: "web_vital", Timestamp: 1_700_000_000_000, PageURL: "https://example.com/",
			Breadcrumbs: []telemetry.Breadcrumb{},
			Payload:     json.RawMessage(`{"name":"fcp","value":120,"unit":"ms","attributes":{}}`),
		}},
	}
	if err := telemetry.ValidateBatch(batch); err != nil {
		t.Fatal(err)
	}
	value, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	return kafkaclient.Message{Topic: "test", Partition: 0, Offset: offset, Value: value}
}
