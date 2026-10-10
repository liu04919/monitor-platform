package kafka

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	kafkaclient "github.com/segmentio/kafka-go"

	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

type messageReader interface {
	FetchMessage(context.Context) (kafkaclient.Message, error)
	CommitMessages(context.Context, ...kafkaclient.Message) error
	Close() error
}

type Consumer struct {
	reader messageReader
	store  ingestion.BatchStore
}

func NewConsumer(brokers []string, topic, group string, store ingestion.BatchStore) *Consumer {
	return &Consumer{
		reader: kafkaclient.NewReader(kafkaclient.ReaderConfig{
			Brokers: brokers, Topic: topic, GroupID: group,
			MinBytes: 1, MaxBytes: maxMessageBytes, MaxWait: time.Second,
			QueueCapacity: 1, StartOffset: kafkaclient.FirstOffset,
			// 手动、同步提交；不能用会提前提交位点的 ReadMessage。
			CommitInterval: 0,
		}),
		store: store,
	}
}

// Run 顺序处理消息。当前消息未完成入库和位点提交前，不处理下一条。
func (c *Consumer) Run(ctx context.Context) error {
	for ctx.Err() == nil {
		message, err := c.reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			slog.Error("读取 Kafka 消息失败，稍后重试", "error", err)
			if err := waitRetry(ctx); err != nil {
				return nil
			}
			continue
		}
		if err := c.process(ctx, message); err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("处理 Kafka 消息 %s/%d/%d: %w", message.Topic, message.Partition, message.Offset, err)
		}
	}
	return nil
}

func (c *Consumer) process(ctx context.Context, message kafkaclient.Message) error {
	var batch telemetry.Batch
	if err := json.Unmarshal(message.Value, &batch); err != nil {
		return fmt.Errorf("解码批次失败，保留位点等待排查: %w", err)
	}
	if err := telemetry.ValidateBatch(batch); err != nil {
		return fmt.Errorf("非法批次，保留位点等待排查: %w", err)
	}

	for {
		attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		_, err := c.store.Save(attemptCtx, batch)
		cancel()
		if err == nil {
			break
		}
		if errors.Is(err, ingestion.ErrBatchIDConflict) {
			return err
		}
		slog.Error("批次入库失败，保留当前消息重试", "batchId", batch.BatchID, "error", err)
		if err := waitRetry(ctx); err != nil {
			return err
		}
	}

	for {
		attemptCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := c.reader.CommitMessages(attemptCtx, message)
		cancel()
		if err == nil {
			return nil
		}
		slog.Error("提交 Kafka 位点失败，稍后重试", "batchId", batch.BatchID, "error", err)
		if err := waitRetry(ctx); err != nil {
			return err
		}
	}
}

func waitRetry(ctx context.Context) error {
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (c *Consumer) Close() error { return c.reader.Close() }
