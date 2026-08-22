package telemetry

import "github.com/liu04919/monitor-platform/apps/server/internal/ingestion"

type Handler struct {
	ingestor ingestion.Service
}

func NewHandler(ingestor ingestion.Service) *Handler {
	return &Handler{ingestor: ingestor}
}
