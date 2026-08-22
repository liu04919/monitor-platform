package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
)

func TestTelemetryBatchReturnsAcceptedResult(t *testing.T) {
	batch := contractBatch(t)
	service := &stubIngestionService{
		result: ingestion.Result{
			Accepted:  len(batch.Events),
			Duplicate: false,
		},
	}

	response := performTelemetryRequest(t, service, mustMarshal(t, batch), "application/json")

	if response.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d: %s", http.StatusAccepted, response.Code, response.Body.String())
	}
	if service.calls != 1 {
		t.Fatalf("expected service to be called once, got %d", service.calls)
	}
	if service.batch.PublicKey != batch.PublicKey {
		t.Fatalf("expected public key %q, got %q", batch.PublicKey, service.batch.PublicKey)
	}

	var body successEnvelope
	decodeResponse(t, response, &body)

	if body.Data.BatchID != batch.BatchID {
		t.Fatalf("expected batch ID %q, got %q", batch.BatchID, body.Data.BatchID)
	}
	if body.Data.Accepted != len(batch.Events) || body.Data.Duplicate {
		t.Fatalf("unexpected ingestion result: %#v", body.Data)
	}
}

func TestTelemetryBatchAcceptsBeaconSimpleContentType(t *testing.T) {
	batch := contractBatch(t)
	service := &stubIngestionService{
		result: ingestion.Result{Accepted: len(batch.Events)},
	}

	response := performTelemetryRequest(
		t,
		service,
		mustMarshal(t, batch),
		"text/plain;charset=UTF-8",
	)

	if response.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d: %s", http.StatusAccepted, response.Code, response.Body.String())
	}
	if service.calls != 1 {
		t.Fatalf("expected service to be called once, got %d calls", service.calls)
	}
}

func TestTelemetryBatchReturnsDuplicateResult(t *testing.T) {
	batch := contractBatch(t)
	service := &stubIngestionService{
		result: ingestion.Result{
			Accepted:  0,
			Duplicate: true,
		},
	}

	response := performTelemetryRequest(t, service, mustMarshal(t, batch), "application/json")

	if response.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d: %s", http.StatusAccepted, response.Code, response.Body.String())
	}

	var body successEnvelope
	decodeResponse(t, response, &body)
	if body.Data.Accepted != 0 || !body.Data.Duplicate {
		t.Fatalf("unexpected duplicate result: %#v", body.Data)
	}
}

func TestTelemetryBatchMapsRequestAndValidationErrors(t *testing.T) {
	validBatch := contractBatch(t)

	invalidBatch := validBatch
	invalidBatch.PublicKey = ""

	invalidEvent := validBatch
	invalidEvent.Events = append([]dto.TelemetryEvent(nil), validBatch.Events...)
	invalidEvent.Events[0].EventType = "not_an_error_type"

	tests := []struct {
		name        string
		contentType string
		body        []byte
		wantStatus  int
		wantCode    string
		wantField   string
	}{
		{
			name:        "unsupported content type",
			contentType: "application/octet-stream",
			body:        mustMarshal(t, validBatch),
			wantStatus:  http.StatusUnsupportedMediaType,
			wantCode:    "UNSUPPORTED_MEDIA_TYPE",
		},
		{
			name:        "malformed JSON",
			contentType: "application/json",
			body:        []byte(`{"schemaVersion":`),
			wantStatus:  http.StatusBadRequest,
			wantCode:    "MALFORMED_JSON",
		},
		{
			name:        "trailing JSON value",
			contentType: "application/json; charset=utf-8",
			body:        append(mustMarshal(t, validBatch), []byte("\n{}")...),
			wantStatus:  http.StatusBadRequest,
			wantCode:    "MALFORMED_JSON",
		},
		{
			name:        "body too large",
			contentType: "application/json",
			body:        []byte(`{"padding":"` + strings.Repeat("x", int(maxTelemetryBodyBytes)) + `"}`),
			wantStatus:  http.StatusRequestEntityTooLarge,
			wantCode:    "PAYLOAD_TOO_LARGE",
		},
		{
			name:        "invalid batch field",
			contentType: "application/json",
			body:        mustMarshal(t, invalidBatch),
			wantStatus:  http.StatusUnprocessableEntity,
			wantCode:    "INVALID_BATCH",
			wantField:   "publicKey",
		},
		{
			name:        "invalid event field",
			contentType: "application/json",
			body:        mustMarshal(t, invalidEvent),
			wantStatus:  http.StatusUnprocessableEntity,
			wantCode:    "INVALID_EVENT",
			wantField:   "events[0].eventType",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &stubIngestionService{}
			response := performTelemetryRequest(t, service, test.body, test.contentType)

			if response.Code != test.wantStatus {
				t.Fatalf("expected status %d, got %d: %s", test.wantStatus, response.Code, response.Body.String())
			}
			if service.calls != 0 {
				t.Fatalf("expected service not to be called, got %d calls", service.calls)
			}

			var body httpapi.ErrorEnvelope
			decodeResponse(t, response, &body)

			if body.Error.Code != test.wantCode {
				t.Fatalf("expected error code %q, got %q", test.wantCode, body.Error.Code)
			}
			if test.wantField == "" {
				if body.Error.Details != nil {
					t.Fatalf("expected no error details, got %#v", body.Error.Details)
				}
				return
			}
			if body.Error.Details == nil || body.Error.Details.Field != test.wantField {
				t.Fatalf("expected field %q, got %#v", test.wantField, body.Error.Details)
			}
		})
	}
}

func TestTelemetryBatchDoesNotExposeIngestionFailure(t *testing.T) {
	service := &stubIngestionService{err: errors.New("database password leaked")}
	response := performTelemetryRequest(t, service, mustMarshal(t, contractBatch(t)), "application/json")

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d", http.StatusInternalServerError, response.Code)
	}
	if service.calls != 1 {
		t.Fatalf("expected service to be called once, got %d", service.calls)
	}
	if strings.Contains(response.Body.String(), "database password") {
		t.Fatalf("response exposed internal error: %s", response.Body.String())
	}

	var body httpapi.ErrorEnvelope
	decodeResponse(t, response, &body)
	if body.Error.Code != "INTERNAL_ERROR" {
		t.Fatalf("expected INTERNAL_ERROR, got %q", body.Error.Code)
	}
}

func TestTelemetryBatchMapsKnownIngestionErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "invalid public key",
			err:        fmt.Errorf("verify project key: %w", ingestion.ErrInvalidPublicKey),
			wantStatus: http.StatusForbidden,
			wantCode:   "INVALID_PUBLIC_KEY",
		},
		{
			name:       "batch ID conflict",
			err:        fmt.Errorf("save batch: %w", ingestion.ErrBatchIDConflict),
			wantStatus: http.StatusConflict,
			wantCode:   "BATCH_ID_CONFLICT",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &stubIngestionService{err: test.err}
			response := performTelemetryRequest(
				t,
				service,
				mustMarshal(t, contractBatch(t)),
				"application/json",
			)

			if response.Code != test.wantStatus {
				t.Fatalf("expected status %d, got %d: %s", test.wantStatus, response.Code, response.Body.String())
			}

			var body httpapi.ErrorEnvelope
			decodeResponse(t, response, &body)
			if body.Error.Code != test.wantCode {
				t.Fatalf("expected error code %q, got %q", test.wantCode, body.Error.Code)
			}
		})
	}
}

type stubIngestionService struct {
	result ingestion.Result
	err    error
	calls  int
	batch  dto.TelemetryBatch
}

func (s *stubIngestionService) Ingest(
	_ context.Context,
	batch dto.TelemetryBatch,
) (ingestion.Result, error) {
	s.calls++
	s.batch = batch
	return s.result, s.err
}

func performTelemetryRequest(
	t *testing.T,
	service ingestion.Service,
	body []byte,
	contentType string,
) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	engine.POST("/api/v1/events/batch", NewHandler(service).Batch)

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/events/batch",
		bytes.NewReader(body),
	)
	request.Header.Set("Content-Type", contentType)

	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	return response
}

func contractBatch(t *testing.T) dto.TelemetryBatch {
	t.Helper()

	path := filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"..",
		"contracts",
		"examples",
		"error-batch-v2.json",
	)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read contract batch: %v", err)
	}

	var batch dto.TelemetryBatch
	if err := json.Unmarshal(data, &batch); err != nil {
		t.Fatalf("decode contract batch: %v", err)
	}
	return batch
}

func mustMarshal(t *testing.T, value any) []byte {
	t.Helper()

	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}
	return data
}

func decodeResponse(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()

	if err := json.Unmarshal(response.Body.Bytes(), target); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}
