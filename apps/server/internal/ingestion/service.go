package ingestion

import (
	"context"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

// Result describes the durable outcome returned by a future ingestion service.
// The HTTP handler must not infer these values before key checks, idempotency,
// and persistence have actually succeeded.
type Result struct {
	Accepted  int
	Duplicate bool
}

// Service owns the business work that begins after the HTTP request has been
// decoded and structurally validated.
type Service interface {
	Ingest(ctx context.Context, batch dto.TelemetryBatch) (Result, error)
}
