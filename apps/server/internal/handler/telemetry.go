package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
	"github.com/liu04919/monitor-platform/apps/server/internal/validation"
)

const maxTelemetryBodyBytes int64 = 1 << 20

type Telemetry struct {
	ingestor ingestion.Service
}

func NewTelemetry(ingestor ingestion.Service) *Telemetry {
	return &Telemetry{ingestor: ingestor}
}

func (h *Telemetry) Batch(c *gin.Context) {
	if !isJSONContentType(c.GetHeader("Content-Type")) {
		writeAPIError(
			c,
			http.StatusUnsupportedMediaType,
			"UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json",
			nil,
		)
		return
	}

	var batch dto.TelemetryBatch
	if err := decodeTelemetryBatch(c, &batch); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeAPIError(
				c,
				http.StatusRequestEntityTooLarge,
				"PAYLOAD_TOO_LARGE",
				"request body must not exceed 1 MiB",
				nil,
			)
			return
		}

		writeAPIError(
			c,
			http.StatusBadRequest,
			"MALFORMED_JSON",
			"request body must contain exactly one valid JSON value",
			nil,
		)
		return
	}

	if err := validation.ValidateTelemetryBatch(batch); err != nil {
		var fieldError *validation.FieldError
		if !errors.As(err, &fieldError) {
			writeAPIError(
				c,
				http.StatusInternalServerError,
				"INTERNAL_ERROR",
				"server could not validate the telemetry batch",
				nil,
			)
			return
		}

		code := "INVALID_BATCH"
		if strings.HasPrefix(fieldError.Field, "events[") {
			code = "INVALID_EVENT"
		}

		writeAPIError(
			c,
			http.StatusUnprocessableEntity,
			code,
			fieldError.Error(),
			&errorDetails{Field: fieldError.Field},
		)
		return
	}

	result, err := h.ingestor.Ingest(c.Request.Context(), batch)
	if err != nil {
		writeAPIError(
			c,
			http.StatusInternalServerError,
			"INTERNAL_ERROR",
			"server could not accept the telemetry batch",
			nil,
		)
		return
	}

	c.JSON(http.StatusAccepted, successEnvelope{
		Data: successData{
			BatchID:   batch.BatchID,
			Accepted:  result.Accepted,
			Duplicate: result.Duplicate,
		},
	})
}

func isJSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	return err == nil && mediaType == "application/json"
}

func decodeTelemetryBatch(c *gin.Context, batch *dto.TelemetryBatch) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxTelemetryBodyBytes)
	decoder := json.NewDecoder(c.Request.Body)

	if err := decoder.Decode(batch); err != nil {
		return err
	}

	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body contains more than one JSON value")
		}
		return err
	}

	return nil
}

type successEnvelope struct {
	Data successData `json:"data"`
}

type successData struct {
	BatchID   string `json:"batchId"`
	Accepted  int    `json:"accepted"`
	Duplicate bool   `json:"duplicate"`
}

type errorEnvelope struct {
	Error apiError `json:"error"`
}

type apiError struct {
	Code    string        `json:"code"`
	Message string        `json:"message"`
	Details *errorDetails `json:"details,omitempty"`
}

type errorDetails struct {
	Field string `json:"field"`
}

func writeAPIError(
	c *gin.Context,
	status int,
	code string,
	message string,
	details *errorDetails,
) {
	c.JSON(status, errorEnvelope{
		Error: apiError{
			Code:    code,
			Message: message,
			Details: details,
		},
	})
}
