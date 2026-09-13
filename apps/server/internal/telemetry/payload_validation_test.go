package telemetry

import (
	"encoding/json"
	"errors"
	"math"
	"testing"
)

func TestValidateBatchRejectsInvalidPayload(t *testing.T) {
	tests := []struct {
		name      string
		category  Category
		eventType string
		payload   string
		wantField string
	}{
		{
			name:      "exception name is missing",
			category:  CategoryError,
			eventType: "js_error",
			payload:   `{"exception":{"message":"boom","stack":[]},"mechanism":{"type":"window.onerror","handled":false}}`,
			wantField: "events[0].payload.exception.name",
		},
		{
			name:      "exception message is missing",
			category:  CategoryError,
			eventType: "react_error",
			payload:   `{"exception":{"name":"TypeError","stack":[]},"mechanism":{"type":"react.error_boundary","handled":true}}`,
			wantField: "events[0].payload.exception.message",
		},
		{
			name:      "exception stack is missing",
			category:  CategoryError,
			eventType: "vue_error",
			payload:   `{"exception":{"name":"TypeError","message":"boom"},"mechanism":{"type":"vue.error_handler","handled":true}}`,
			wantField: "events[0].payload.exception.stack",
		},
		{
			name:      "mechanism type is unsupported",
			category:  CategoryError,
			eventType: "js_error",
			payload:   `{"exception":{"name":"TypeError","message":"boom","stack":[]},"mechanism":{"type":"unknown","handled":false}}`,
			wantField: "events[0].payload.mechanism.type",
		},
		{
			name:      "mechanism handled is missing",
			category:  CategoryError,
			eventType: "js_error",
			payload:   `{"exception":{"name":"TypeError","message":"boom","stack":[]},"mechanism":{"type":"window.onerror"}}`,
			wantField: "events[0].payload.mechanism.handled",
		},
		{
			name:      "resource message is missing",
			category:  CategoryError,
			eventType: "resource_error",
			payload:   `{"resource":{"url":"https://example.com/app.js"},"mechanism":{"type":"resource.error","handled":false}}`,
			wantField: "events[0].payload.message",
		},
		{
			name:      "resource URL is missing",
			category:  CategoryError,
			eventType: "resource_error",
			payload:   `{"message":"load failed","resource":{},"mechanism":{"type":"resource.error","handled":false}}`,
			wantField: "events[0].payload.resource.url",
		},
		{
			name:      "metric name is missing",
			category:  CategoryPerformance,
			eventType: "web_vital",
			payload:   `{"value":0,"unit":"ms"}`,
			wantField: "events[0].payload.name",
		},
		{
			name:      "metric value is missing",
			category:  CategoryPerformance,
			eventType: "page_load",
			payload:   `{"name":"page-load","unit":"ms"}`,
			wantField: "events[0].payload.value",
		},
		{
			name:      "metric unit is invalid",
			category:  CategoryAI,
			eventType: "stream_metric",
			payload:   `{"name":"ai-stream","value":1,"unit":"seconds"}`,
			wantField: "events[0].payload.unit",
		},
		{
			name:      "metric attributes are not an object",
			category:  CategoryPerformance,
			eventType: "http_request",
			payload:   `{"name":"fetch","value":1,"unit":"ms","attributes":[]}`,
			wantField: "events[0].payload.attributes",
		},
		{
			name:      "behavior data is not an object",
			category:  CategoryBehavior,
			eventType: "click",
			payload:   `{"message":"click button","data":[]}`,
			wantField: "events[0].payload.data",
		},
		{
			name:      "stability message is missing",
			category:  CategoryStability,
			eventType: "stutter",
			payload:   `{"metrics":{"duration":180}}`,
			wantField: "events[0].payload.message",
		},
		{
			name:      "stability diagnostics are not an object",
			category:  CategoryStability,
			eventType: "stutter",
			payload:   `{"message":"slow frame","diagnostics":[]}`,
			wantField: "events[0].payload.diagnostics",
		},
		{
			name:      "stability diagnostics cannot be null",
			category:  CategoryStability,
			eventType: "stutter",
			payload:   `{"message":"slow frame","diagnostics":null}`,
			wantField: "events[0].payload.diagnostics",
		},
		{
			name:      "payload field has the wrong JSON type",
			category:  CategoryStability,
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

			if test.category != CategoryError && test.category != CategoryStability {
				batch.Events[0].Level = nil
				batch.Events[0].Breadcrumbs = nil
			}

			err := ValidateBatch(batch)
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
	batch.Events[0].Category = CategoryPerformance
	batch.Events[0].EventType = "web_vital"
	batch.Events[0].Level = nil
	batch.Events[0].Breadcrumbs = nil
	batch.Events[0].Payload = json.RawMessage(`{"name":"CLS","value":0,"unit":"count"}`)

	if err := ValidateBatch(batch); err != nil {
		t.Fatalf("validate zero metric and false handled values: %v", err)
	}
}

func TestPayloadValidationRejectsNonFiniteProgrammaticValues(t *testing.T) {
	t.Run("metric value", func(t *testing.T) {
		value := math.Inf(1)
		payload := MetricPayload{
			Name:  "FCP",
			Value: &value,
			Unit:  MetricUnitMilliseconds,
		}

		assertFieldError(
			t,
			validateMetricPayload(payload, "events[0].payload"),
			"events[0].payload.value",
		)
	})

	t.Run("stability metric", func(t *testing.T) {
		payload := StabilityPayload{
			Message: "Page stuttered",
			Metrics: map[string]float64{
				"duration": math.NaN(),
			},
		}

		assertFieldError(
			t,
			validateStabilityPayload(payload, "events[0].payload"),
			"events[0].payload.metrics.duration",
		)
	})
}

func TestStutterDiagnosticsAreValidatedWithoutChangingPayload(t *testing.T) {
	batch := validTelemetryBatch()
	batch.Events[0].Category = CategoryStability
	batch.Events[0].EventType = "stutter"
	batch.Events[0].Payload = json.RawMessage(`{"message":"页面慢帧持续 230ms","metrics":{"duration":230,"blockingDuration":150},"diagnostics":{"source":"long-animation-frame","scripts":[{"sourceURL":"https://example.com/app.js","duration":180}],"longTasks":{"count":1,"maxDuration":200},"rafGap":{"startTime":1100,"duration":240}}}`)
	want := string(batch.Events[0].Payload)
	if err := ValidateBatch(batch); err != nil {
		t.Fatalf("validate LoAF diagnostics: %v", err)
	}
	// 校验 DTO 不重写 payload，完整诊断对象继续由原写入链路保存。
	if string(batch.Events[0].Payload) != want {
		t.Fatal("validation changed the original payload")
	}
	var payload StabilityPayload
	if err := json.Unmarshal(batch.Events[0].Payload, &payload); err != nil {
		t.Fatal(err)
	}
	var diagnostics struct {
		Source string `json:"source"`
	}
	if err := json.Unmarshal(payload.Diagnostics, &diagnostics); err != nil {
		t.Fatal(err)
	}
	if diagnostics.Source != "long-animation-frame" {
		t.Fatalf("unexpected diagnostics: %s", payload.Diagnostics)
	}
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
