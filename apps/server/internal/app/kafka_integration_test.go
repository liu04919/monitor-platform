//go:build integration

package app_test

import (
	"context"
	"errors"
	"testing"
	"time"

	kafkaclient "github.com/segmentio/kafka-go"

	"github.com/liu04919/monitor-platform/apps/server/internal/app"
	"github.com/liu04919/monitor-platform/apps/server/internal/config"
)

func createApplicationTopic(t *testing.T, cfg config.Config) *kafkaclient.Client {
	t.Helper()
	transport := &kafkaclient.Transport{}
	t.Cleanup(transport.CloseIdleConnections)
	client := &kafkaclient.Client{Addr: kafkaclient.TCP(cfg.KafkaBrokers...), Timeout: 10 * time.Second, Transport: transport}
	result, err := client.CreateTopics(context.Background(), &kafkaclient.CreateTopicsRequest{
		Topics: []kafkaclient.TopicConfig{{Topic: cfg.KafkaTopic, NumPartitions: 1, ReplicationFactor: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := result.Errors[cfg.KafkaTopic]; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		deleted, err := client.DeleteTopics(ctx, &kafkaclient.DeleteTopicsRequest{Topics: []string{cfg.KafkaTopic}})
		if err != nil {
			t.Errorf("清理测试 Topic: %v", err)
			return
		}
		if err := deleted.Errors[cfg.KafkaTopic]; err != nil {
			t.Errorf("清理测试 Topic: %v", err)
		}
		groups, err := client.DeleteGroups(ctx, &kafkaclient.DeleteGroupsRequest{GroupIDs: []string{cfg.KafkaConsumerGroup}})
		if err != nil {
			t.Errorf("清理测试消费组: %v", err)
			return
		}
		if err := groups.Errors[cfg.KafkaConsumerGroup]; err != nil && !errors.Is(err, kafkaclient.GroupIdNotFound) {
			t.Errorf("清理测试消费组: %v", err)
		}
	})
	return client
}

func startApplicationWorker(t *testing.T, cfg config.Config) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	worker, err := app.NewWorker(ctx, cfg)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()
	stopped := false
	stop := func() {
		if stopped {
			return
		}
		stopped = true
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("消费者异常退出: %v", err)
			}
		case <-time.After(15 * time.Second):
			t.Error("消费者未及时停止")
		}
		if err := worker.Close(); err != nil {
			t.Errorf("关闭消费者: %v", err)
		}
	}
	t.Cleanup(stop)
	return stop
}

func waitApplicationOffset(t *testing.T, client *kafkaclient.Client, cfg config.Config, want int64) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	var last any
	for ctx.Err() == nil {
		result, err := client.OffsetFetch(ctx, &kafkaclient.OffsetFetchRequest{
			GroupID: cfg.KafkaConsumerGroup, Topics: map[string][]int{cfg.KafkaTopic: {0}},
		})
		last = err
		if err == nil {
			last = result
			for _, partition := range result.Topics[cfg.KafkaTopic] {
				if result.Error == nil && partition.Error == nil && partition.CommittedOffset == want {
					return
				}
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(100 * time.Millisecond):
		}
	}
	t.Fatalf("等待 Kafka 提交位点 %d 超时，最后结果 %#v", want, last)
}
