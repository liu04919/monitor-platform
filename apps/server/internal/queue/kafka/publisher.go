// kafka 包实现遥测批次的发布和消费，不负责业务校验与数据库操作。
package kafka

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"

	kafkaclient "github.com/segmentio/kafka-go"

	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

const maxMessageBytes = 4 << 20

type Publisher struct {
	writer *kafkaclient.Writer
}

func NewPublisher(brokers []string, topic string) *Publisher {
	return &Publisher{writer: &kafkaclient.Writer{
		Addr: kafkaclient.TCP(brokers...), Topic: topic,
		Balancer: &kafkaclient.Hash{}, RequiredAcks: kafkaclient.RequireAll,
		// 每个 SDK 批次对应一条消息，等待 broker 确认，禁止异步提前返回。
		BatchSize: 1, BatchBytes: maxMessageBytes, Async: false,
		MaxAttempts: 3, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second,
		AllowAutoTopicCreation: false,
	}}
}

func (p *Publisher) Publish(ctx context.Context, batch telemetry.Batch) error {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(batch); err != nil {
		return fmt.Errorf("编码 Kafka 批次: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	return p.writer.WriteMessages(ctx, kafkaclient.Message{
		// 相同批次始终进入同一分区；当前版本保持 Topic 分区数不变。
		Key: []byte(batch.App.ID + "\x00" + batch.BatchID), Value: body.Bytes(),
	})
}

func (p *Publisher) Close() error { return p.writer.Close() }
