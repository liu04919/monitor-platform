package telemetry

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateBatchAcceptsContractExamples(t *testing.T) {
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

			if err := ValidateBatch(batch); err != nil {
				t.Fatalf("validate contract example: %v", err)
			}
		})
	}
}

func TestValidateBatchAcceptsValidStructure(t *testing.T) {
	if err := ValidateBatch(validTelemetryBatch()); err != nil {
		t.Fatalf("validate minimal batch: %v", err)
	}
}

func TestValidateBatchRejectsInvalidStructure(t *testing.T) {
	tests := []struct {
		name      string
		mutate    func(*Batch)
		wantField string
	}{
		{
			name: "batch schema version",
			mutate: func(batch *Batch) {
				batch.SchemaVersion = 1
			},
			wantField: "schemaVersion",
		},
		{
			name: "blank batch ID",
			mutate: func(batch *Batch) {
				batch.BatchID = "   "
			},
			wantField: "batchId",
		},
		{
			name: "negative sent time",
			mutate: func(batch *Batch) {
				batch.SentAt = -1
			},
			wantField: "sentAt",
		},
		{
			name: "missing public key",
			mutate: func(batch *Batch) {
				batch.PublicKey = ""
			},
			wantField: "publicKey",
		},
		{
			name: "public key too long",
			mutate: func(batch *Batch) {
				batch.PublicKey = strings.Repeat("a", maxPublicKeyLength+1)
			},
			wantField: "publicKey",
		},
		{
			name: "missing app ID",
			mutate: func(batch *Batch) {
				batch.App.ID = ""
			},
			wantField: "app.id",
		},
		{
			name: "app name too long",
			mutate: func(batch *Batch) {
				batch.App.Name = strings.Repeat("a", maxAppNameLength+1)
			},
			wantField: "app.name",
		},
		{
			name: "empty events",
			mutate: func(batch *Batch) {
				batch.Events = nil
			},
			wantField: "events",
		},
		{
			name: "too many events",
			mutate: func(batch *Batch) {
				batch.Events = make([]Event, maxEventsPerBatch+1)
			},
			wantField: "events",
		},
		{
			name: "invalid send type",
			mutate: func(batch *Batch) {
				batch.SendType = "socket"
			},
			wantField: "sendType",
		},
		{
			name: "event schema version",
			mutate: func(batch *Batch) {
				batch.Events[0].SchemaVersion = 1
			},
			wantField: "events[0].schemaVersion",
		},
		{
			name: "missing event ID",
			mutate: func(batch *Batch) {
				batch.Events[0].EventID = ""
			},
			wantField: "events[0].eventId",
		},
		{
			name: "unsupported category",
			mutate: func(batch *Batch) {
				batch.Events[0].Category = "unknown"
			},
			wantField: "events[0].category",
		},
		{
			name: "event type does not match category",
			mutate: func(batch *Batch) {
				batch.Events[0].Category = CategoryPerformance
			},
			wantField: "events[0].eventType",
		},
		{
			name: "negative event timestamp",
			mutate: func(batch *Batch) {
				batch.Events[0].Timestamp = -1
			},
			wantField: "events[0].timestamp",
		},
		{
			name: "page URL too long",
			mutate: func(batch *Batch) {
				batch.Events[0].PageURL = strings.Repeat("a", maxPageURLLength+1)
			},
			wantField: "events[0].pageUrl",
		},
		{
			name: "user ID too long",
			mutate: func(batch *Batch) {
				userID := strings.Repeat("a", maxIDLength+1)
				batch.Events[0].UserID = &userID
			},
			wantField: "events[0].userId",
		},
		{
			name: "missing diagnostic level",
			mutate: func(batch *Batch) {
				batch.Events[0].Level = nil
			},
			wantField: "events[0].level",
		},
		{
			name: "invalid diagnostic level",
			mutate: func(batch *Batch) {
				level := Level("critical")
				batch.Events[0].Level = &level
			},
			wantField: "events[0].level",
		},
		{
			name: "missing breadcrumbs",
			mutate: func(batch *Batch) {
				batch.Events[0].Breadcrumbs = nil
			},
			wantField: "events[0].breadcrumbs",
		},
		{
			name: "invalid breadcrumb category",
			mutate: func(batch *Batch) {
				batch.Events[0].Breadcrumbs = []Breadcrumb{{
					Timestamp: 1,
					Category:  "database",
				}}
			},
			wantField: "events[0].breadcrumbs[0].category",
		},
		{
			name: "breadcrumb data is not an object",
			mutate: func(batch *Batch) {
				batch.Events[0].Breadcrumbs = []Breadcrumb{{
					Timestamp: 1,
					Category:  BreadcrumbCategoryClick,
					Data:      json.RawMessage(`[]`),
				}}
			},
			wantField: "events[0].breadcrumbs[0].data",
		},
		{
			name: "payload is missing",
			mutate: func(batch *Batch) {
				batch.Events[0].Payload = nil
			},
			wantField: "events[0].payload",
		},
		{
			name: "payload is not an object",
			mutate: func(batch *Batch) {
				batch.Events[0].Payload = json.RawMessage(`[]`)
			},
			wantField: "events[0].payload",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			batch := validTelemetryBatch()
			test.mutate(&batch)

			err := ValidateBatch(batch)
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

func validTelemetryBatch() Batch {
	level := LevelError

	return Batch{
		SchemaVersion: schemaVersion,
		BatchID:       "batch-1",
		SentAt:        2,
		PublicKey:     "pk_monitor_web_demo",
		App: App{
			ID:   "7b5d9a2f-3c61-4e88-9f42-2d6b81a530c7",
			Name: "Monitor Web",
		},
		Events: []Event{
			{
				SchemaVersion: schemaVersion,
				EventID:       "event-1",
				Category:      CategoryError,
				EventType:     "js_error",
				Timestamp:     1,
				PageURL:       "https://monitor.example.com",
				Level:         &level,
				Breadcrumbs:   []Breadcrumb{},
				Payload: json.RawMessage(`{
					"exception": {
						"name": "TypeError",
						"message": "boom",
						"stack": []
					},
					"mechanism": {
						"type": "window.onerror",
						"handled": false
					}
				}`),
			},
		},
		SendType: SendTypeFetch,
	}
}
