package validation

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

func TestValidateTelemetryBatchAcceptsContractExamples(t *testing.T) {
	paths, err := filepath.Glob(contractFixturePattern())
	if err != nil {
		t.Fatalf("find contract examples: %v", err)
	}
	if len(paths) != 6 {
		t.Fatalf("expected 6 contract examples, found %d", len(paths))
	}

	for _, path := range paths {
		t.Run(filepath.Base(path), func(t *testing.T) {
			batch := readContractBatch(t, path)

			if err := ValidateTelemetryBatch(batch); err != nil {
				t.Fatalf("validate contract example: %v", err)
			}
		})
	}
}

func TestValidateTelemetryBatchAcceptsValidStructure(t *testing.T) {
	if err := ValidateTelemetryBatch(validTelemetryBatch()); err != nil {
		t.Fatalf("validate minimal batch: %v", err)
	}
}

func TestValidateTelemetryBatchRejectsInvalidStructure(t *testing.T) {
	tests := []struct {
		name      string
		mutate    func(*dto.TelemetryBatch)
		wantField string
	}{
		{
			name: "batch schema version",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.SchemaVersion = 1
			},
			wantField: "schemaVersion",
		},
		{
			name: "blank batch ID",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.BatchID = "   "
			},
			wantField: "batchId",
		},
		{
			name: "negative sent time",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.SentAt = -1
			},
			wantField: "sentAt",
		},
		{
			name: "missing app ID",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.App.ID = ""
			},
			wantField: "app.id",
		},
		{
			name: "app name too long",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.App.Name = strings.Repeat("a", maxAppNameLength+1)
			},
			wantField: "app.name",
		},
		{
			name: "empty events",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events = nil
			},
			wantField: "events",
		},
		{
			name: "too many events",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events = make([]dto.TelemetryEvent, maxEventsPerBatch+1)
			},
			wantField: "events",
		},
		{
			name: "invalid send type",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.SendType = "socket"
			},
			wantField: "sendType",
		},
		{
			name: "event schema version",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].SchemaVersion = 1
			},
			wantField: "events[0].schemaVersion",
		},
		{
			name: "missing event ID",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].EventID = ""
			},
			wantField: "events[0].eventId",
		},
		{
			name: "unsupported category",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].Category = "unknown"
			},
			wantField: "events[0].category",
		},
		{
			name: "event type does not match category",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].Category = dto.EventCategoryPerformance
			},
			wantField: "events[0].eventType",
		},
		{
			name: "negative event timestamp",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].Timestamp = -1
			},
			wantField: "events[0].timestamp",
		},
		{
			name: "page URL too long",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].PageURL = strings.Repeat("a", maxPageURLLength+1)
			},
			wantField: "events[0].pageUrl",
		},
		{
			name: "user ID too long",
			mutate: func(batch *dto.TelemetryBatch) {
				userID := strings.Repeat("a", maxIDLength+1)
				batch.Events[0].UserID = &userID
			},
			wantField: "events[0].userId",
		},
		{
			name: "missing diagnostic level",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].Level = nil
			},
			wantField: "events[0].level",
		},
		{
			name: "invalid diagnostic level",
			mutate: func(batch *dto.TelemetryBatch) {
				level := dto.EventLevel("critical")
				batch.Events[0].Level = &level
			},
			wantField: "events[0].level",
		},
		{
			name: "missing breadcrumbs",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].Breadcrumbs = nil
			},
			wantField: "events[0].breadcrumbs",
		},
		{
			name: "invalid breadcrumb category",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].Breadcrumbs = []dto.Breadcrumb{{
					Timestamp: 1,
					Category:  "database",
				}}
			},
			wantField: "events[0].breadcrumbs[0].category",
		},
		{
			name: "breadcrumb data is not an object",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].Breadcrumbs = []dto.Breadcrumb{{
					Timestamp: 1,
					Category:  dto.BreadcrumbCategoryClick,
					Data:      json.RawMessage(`[]`),
				}}
			},
			wantField: "events[0].breadcrumbs[0].data",
		},
		{
			name: "payload is missing",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].Payload = nil
			},
			wantField: "events[0].payload",
		},
		{
			name: "payload is not an object",
			mutate: func(batch *dto.TelemetryBatch) {
				batch.Events[0].Payload = json.RawMessage(`[]`)
			},
			wantField: "events[0].payload",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			batch := validTelemetryBatch()
			test.mutate(&batch)

			err := ValidateTelemetryBatch(batch)
			if err == nil {
				t.Fatalf("expected validation error for %s", test.wantField)
			}

			var fieldError *FieldError
			if !errors.As(err, &fieldError) {
				t.Fatalf("expected FieldError, got %T: %v", err, err)
			}
			if fieldError.Field != test.wantField {
				t.Fatalf("expected field %q, got %q", test.wantField, fieldError.Field)
			}
		})
	}
}

func validTelemetryBatch() dto.TelemetryBatch {
	level := dto.EventLevelError

	return dto.TelemetryBatch{
		SchemaVersion: schemaVersion,
		BatchID:       "batch-1",
		SentAt:        2,
		App: dto.App{
			ID:   "monitor-web",
			Name: "Monitor Web",
		},
		Events: []dto.TelemetryEvent{
			{
				SchemaVersion: schemaVersion,
				EventID:       "event-1",
				Category:      dto.EventCategoryError,
				EventType:     "js_error",
				Timestamp:     1,
				PageURL:       "https://monitor.example.com",
				Level:         &level,
				Breadcrumbs:   []dto.Breadcrumb{},
				Payload:       json.RawMessage(`{"exception":{},"mechanism":{}}`),
			},
		},
		SendType: dto.SendTypeFetch,
	}
}

func readContractBatch(t *testing.T, path string) dto.TelemetryBatch {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read contract example %q: %v", filepath.Base(path), err)
	}

	var batch dto.TelemetryBatch
	if err := json.Unmarshal(data, &batch); err != nil {
		t.Fatalf("decode contract example %q: %v", filepath.Base(path), err)
	}

	return batch
}

func contractFixturePattern() string {
	return filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"contracts",
		"examples",
		"*-batch-v2.json",
	)
}
