package dto

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestTelemetryBatchDecodesContractExamples(t *testing.T) {
	expectedEventCounts := map[string]int{
		"ai-batch-v2.json":          2,
		"behavior-batch-v2.json":    4,
		"crash-batch-v2.json":       1,
		"error-batch-v2.json":       2,
		"performance-batch-v2.json": 5,
		"stability-batch-v2.json":   2,
	}

	paths, err := filepath.Glob(contractFixturePattern())
	if err != nil {
		t.Fatalf("find contract examples: %v", err)
	}
	if len(paths) != len(expectedEventCounts) {
		t.Fatalf("expected %d contract examples, found %d", len(expectedEventCounts), len(paths))
	}

	totalEvents := 0

	for _, path := range paths {
		name := filepath.Base(path)
		expectedCount, ok := expectedEventCounts[name]
		if !ok {
			t.Fatalf("contract example %q is missing from the test table", name)
		}

		t.Run(name, func(t *testing.T) {
			batch := readContractBatch(t, path)

			if batch.SchemaVersion != 2 {
				t.Fatalf("expected batch schema version 2, got %d", batch.SchemaVersion)
			}
			if batch.BatchID == "" {
				t.Fatal("expected a batch ID")
			}
			if batch.App.ID == "" || batch.App.Name == "" {
				t.Fatalf("expected app identity, got %#v", batch.App)
			}
			if len(batch.Events) != expectedCount {
				t.Fatalf("expected %d events, got %d", expectedCount, len(batch.Events))
			}

			for index, event := range batch.Events {
				if event.SchemaVersion != 2 {
					t.Fatalf("events[%d]: expected schema version 2, got %d", index, event.SchemaVersion)
				}
				if event.EventID == "" || event.Category == "" || event.EventType == "" {
					t.Fatalf("events[%d]: expected event identity, got %#v", index, event)
				}
				if len(event.Payload) == 0 || !json.Valid(event.Payload) {
					t.Fatalf("events[%d]: payload is not valid JSON", index)
				}
			}

			totalEvents += len(batch.Events)
		})
	}

	if totalEvents != 16 {
		t.Fatalf("expected 16 events across all examples, got %d", totalEvents)
	}
}

func TestCrashPayloadCanBeDecodedByEventType(t *testing.T) {
	batch := readContractBatch(
		t,
		filepath.Join(contractExamplesDirectory(), "crash-batch-v2.json"),
	)

	if len(batch.Events) != 1 {
		t.Fatalf("expected one crash event, got %d", len(batch.Events))
	}

	event := batch.Events[0]
	if event.Category != EventCategoryStability || event.EventType != "crash" {
		t.Fatalf("expected a stability crash event, got %s/%s", event.Category, event.EventType)
	}
	if event.ReplayData != nil {
		t.Fatalf("expected omitted replayData to decode as nil, got %q", *event.ReplayData)
	}

	var payload struct {
		Message string `json:"message"`
		Metrics struct {
			Timeout              int     `json:"timeout"`
			UnresponsiveDuration float64 `json:"unresponsiveDuration"`
		} `json:"metrics"`
	}

	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatalf("decode crash payload: %v", err)
	}
	if payload.Message == "" {
		t.Fatal("expected a crash message")
	}
	if payload.Metrics.Timeout != 15_000 {
		t.Fatalf("expected timeout 15000, got %d", payload.Metrics.Timeout)
	}
	if payload.Metrics.UnresponsiveDuration <= float64(payload.Metrics.Timeout) {
		t.Fatalf(
			"expected unresponsive duration to exceed timeout, got %.1f",
			payload.Metrics.UnresponsiveDuration,
		)
	}
}

func readContractBatch(t *testing.T, path string) TelemetryBatch {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read contract example %q: %v", filepath.Base(path), err)
	}

	var batch TelemetryBatch
	if err := json.Unmarshal(data, &batch); err != nil {
		t.Fatalf("decode contract example %q: %v", filepath.Base(path), err)
	}

	return batch
}

func contractFixturePattern() string {
	return filepath.Join(contractExamplesDirectory(), "*-batch-v2.json")
}

func contractExamplesDirectory() string {
	return filepath.Join("..", "..", "..", "..", "contracts", "examples")
}
