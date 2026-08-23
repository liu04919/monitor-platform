package issue

import (
	"encoding/json"
	"testing"

	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

func TestComputeUsesExceptionLocationInsteadOfMessage(t *testing.T) {
	first := errorEvent("js_error", `{
		"exception": {
			"name": "TypeError",
			"message": "profile 42 failed",
			"stack": [{"filename":"https://EXAMPLE.com/app.js?v=1","functionName":"render","line":12,"column":7}]
		}
	}`)
	second := errorEvent("js_error", `{
		"exception": {
			"name": "TypeError",
			"message": "profile 99 failed",
			"stack": [{"filename":"https://example.com/app.js?v=2","functionName":"render","line":12,"column":7}]
		}
	}`)

	firstFingerprint := mustFingerprint(t, first)
	secondFingerprint := mustFingerprint(t, second)
	if firstFingerprint != secondFingerprint {
		t.Fatalf("same location fingerprints differ: %q != %q", firstFingerprint, secondFingerprint)
	}

	second.Payload = json.RawMessage(`{
		"exception": {
			"name": "TypeError",
			"message": "profile 99 failed",
			"stack": [{"filename":"https://example.com/app.js","functionName":"render","line":13,"column":7}]
		}
	}`)
	if firstFingerprint == mustFingerprint(t, second) {
		t.Fatal("different stack locations produced the same fingerprint")
	}
}

func TestComputeNormalizesResourceURLAndFallbackMessage(t *testing.T) {
	resourceA := errorEvent("resource_error", `{"message":"load failed","resource":{"url":"https://cdn.example.com/app.js?v=1","tagName":"SCRIPT"}}`)
	resourceB := errorEvent("resource_error", `{"message":"another message","resource":{"url":"https://cdn.example.com/app.js?v=2#chunk","tagName":"script"}}`)
	if mustFingerprint(t, resourceA) != mustFingerprint(t, resourceB) {
		t.Fatal("resource query/hash should not split one issue")
	}

	fallbackA := errorEvent("unhandled_rejection", `{"exception":{"name":"Error","message":"request 42 failed for 11111111-1111-4111-8111-111111111111","stack":[]}}`)
	fallbackB := errorEvent("unhandled_rejection", `{"exception":{"name":"Error","message":"request 99 failed for 22222222-2222-4222-8222-222222222222","stack":[]}}`)
	if mustFingerprint(t, fallbackA) != mustFingerprint(t, fallbackB) {
		t.Fatal("dynamic numbers and UUIDs should not split a fallback issue")
	}
}

func TestComputeIgnoresNonErrorEvents(t *testing.T) {
	event := errorEvent("web_vital", `{"name":"LCP"}`)
	event.Category = telemetry.CategoryPerformance
	fingerprint, err := Fingerprint(event)
	if err != nil || fingerprint != "" {
		t.Fatalf("Compute() = %q, %v", fingerprint, err)
	}
}

func errorEvent(eventType, payload string) telemetry.Event {
	return telemetry.Event{
		Category:  telemetry.CategoryError,
		EventType: eventType,
		Payload:   json.RawMessage(payload),
	}
}

func mustFingerprint(t *testing.T, event telemetry.Event) string {
	t.Helper()
	fingerprint, err := Fingerprint(event)
	if err != nil {
		t.Fatalf("Compute() error = %v", err)
	}
	if len(fingerprint) != 32 {
		t.Fatalf("fingerprint = %q, want 32 hex chars", fingerprint)
	}
	return fingerprint
}
