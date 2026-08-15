package validation

import (
	"encoding/json"
	"errors"
	"math"
	"testing"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

func TestValidateTelemetryBatchRejectsInvalidPayload(t *testing.T) {
	tests := []struct {
		name      string
		category  dto.EventCategory
		eventType string
		payload   string
		wantField string
	}{
		{
			name:      "exception name is missing",
			category:  dto.EventCategoryError,
			eventType: "js_error",
			payload:   `{"exception":{"message":"boom","stack":[]},"mechanism":{"type":"window.onerror","handled":false}}`,
			wantField: "events[0].payload.exception.name",
		},
		{
			name:      "exception message is missing",
			category:  dto.EventCategoryError,
			eventType: "react_error",
			payload:   `{"exception":{"name":"TypeError","stack":[]},"mechanism":{"type":"react.error_boundary","handled":true}}`,
			wantField: "events[0].payload.exception.message",
		},
		{
			name:      "exception stack is missing",
			category:  dto.EventCategoryError,
			eventType: "vue_error",
			payload:   `{"exception":{"name":"TypeError","message":"boom"},"mechanism":{"type":"vue.error_handler","handled":true}}`,
			wantField: "events[0].payload.exception.stack",
		},
		{
			name:      "mechanism type is unsupported",
			category:  dto.EventCategoryError,
			eventType: "js_error",
			payload:   `{"exception":{"name":"TypeError","message":"boom","stack":[]},"mechanism":{"type":"unknown","handled":false}}`,
			wantField: "events[0].payload.mechanism.type",
		},
		{
			name:      "mechanism handled is missing",
			category:  dto.EventCategoryError,
			eventType: "js_error",
			payload:   `{"exception":{"name":"TypeError","message":"boom","stack":[]},"mechanism":{"type":"window.onerror"}}`,
			wantField: "events[0].payload.mechanism.handled",
		},
		{
			name:      "resource message is missing",
			category:  dto.EventCategoryError,
			eventType: "resource_error",
			payload:   `{"resource":{"url":"https://example.com/app.js"},"mechanism":{"type":"resource.error","handled":false}}`,
			wantField: "events[0].payload.message",
		},
		{
			name:      "resource URL is missing",
			category:  dto.EventCategoryError,
			eventType: "resource_error",
			payload:   `{"message":"load failed","resource":{},"mechanism":{"type":"resource.error","handled":false}}`,
			wantField: "events[0].payload.resource.url",
		},
		{
			name:      "metric name is missing",
			category:  dto.EventCategoryPerformance,
			eventType: "web_vital",
			payload:   `{"value":0,"unit":"ms"}`,
			wantField: "events[0].payload.name",
		},
		{
			name:      "metric value is missing",
			category:  dto.EventCategoryPerformance,
			eventType: "page_load",
			payload:   `{"name":"page-load","unit":"ms"}`,
			wantField: "events[0].payload.value",
		},
		{
			name:      "metric unit is invalid",
			category:  dto.EventCategoryAI,
			eventType: "stream_metric",
			payload:   `{"name":"ai-stream","value":1,"unit":"seconds"}`,
			wantField: "events[0].payload.unit",
		},
		{
			name:      "metric attributes are not an object",
			category:  dto.EventCategoryPerformance,
			eventType: "http_request",
			payload:   `{"name":"fetch","value":1,"unit":"ms","attributes":[]}`,
			wantField: "events[0].payload.attributes",
		},
		{
			name:      "behavior data is not an object",
			category:  dto.EventCategoryBehavior,
			eventType: "click",
			payload:   `{"message":"click button","data":[]}`,
			wantField: "events[0].payload.data",
		},
		{
			name:      "stability message is missing",
			category:  dto.EventCategoryStability,
			eventType: "stutter",
			payload:   `{"metrics":{"fps":18}}`,
			wantField: "events[0].payload.message",
		},
		{
			name:      "payload field has the wrong JSON type",
			category:  dto.EventCategoryStability,
			eventType: "crash",
			payload:   `{"message":"crash","metrics":{"timeout":"slow"}}`,
			wantField: "events[0].payload",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			batch := validTelemetryBatch()
			batch.Events[0].Category = test.category
			batch.Events[0].EventType = test.eventType
			batch.Events[0].Payload = json.RawMessage(test.payload)

			if test.category != dto.EventCategoryError && test.category != dto.EventCategoryStability {
				batch.Events[0].Level = nil
				batch.Events[0].Breadcrumbs = nil
			}

			err := ValidateTelemetryBatch(batch)
			if err == nil {
				t.Fatalf("expected validation error for %s", test.wantField)
			}

			var fieldError *FieldError
			if !errors.As(err, &fieldError) {
				t.Fatalf("expected FieldError, got %T: %v", err, err)
			}
			if fieldError.Field != test.wantField {
				t.Fatalf("expected field %q, got %q: %v", test.wantField, fieldError.Field, err)
			}
		})
	}
}

func TestPayloadValidationPreservesValidZeroValues(t *testing.T) {
	batch := validTelemetryBatch()
	batch.Events[0].Category = dto.EventCategoryPerformance
	batch.Events[0].EventType = "web_vital"
	batch.Events[0].Level = nil
	batch.Events[0].Breadcrumbs = nil
	batch.Events[0].Payload = json.RawMessage(`{"name":"CLS","value":0,"unit":"count"}`)

	if err := ValidateTelemetryBatch(batch); err != nil {
		t.Fatalf("validate zero metric and false handled values: %v", err)
	}
}

func TestPayloadValidationRejectsNonFiniteProgrammaticValues(t *testing.T) {
	t.Run("metric value", func(t *testing.T) {
		value := math.Inf(1)
		payload := dto.MetricPayload{
			Name:  "FCP",
			Value: &value,
			Unit:  dto.MetricUnitMilliseconds,
		}

		assertFieldError(
			t,
			validateMetricPayload(payload, "events[0].payload"),
			"events[0].payload.value",
		)
	})

	t.Run("stability metric", func(t *testing.T) {
		payload := dto.StabilityPayload{
			Message: "Page stuttered",
			Metrics: map[string]float64{
				"fps": math.NaN(),
			},
		}

		assertFieldError(
			t,
			validateStabilityPayload(payload, "events[0].payload"),
			"events[0].payload.metrics.fps",
		)
	})
}

func assertFieldError(t *testing.T, err error, wantField string) {
	t.Helper()

	if err == nil {
		t.Fatalf("expected validation error for %s", wantField)
	}

	var fieldError *FieldError
	if !errors.As(err, &fieldError) {
		t.Fatalf("expected FieldError, got %T: %v", err, err)
	}
	if fieldError.Field != wantField {
		t.Fatalf("expected field %q, got %q", wantField, fieldError.Field)
	}
}
