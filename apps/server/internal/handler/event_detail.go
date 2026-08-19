package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/eventquery"
)

func (h *EventListHandler) Detail(c *gin.Context) {
	event, err := h.service.Detail(c.Request.Context(), eventquery.DetailRequest{
		ProjectID: c.Param("projectId"),
		EventID:   c.Param("eventId"),
	})
	if err != nil {
		writeEventDetailError(c, err)
		return
	}

	c.JSON(http.StatusOK, eventDetailEnvelope{
		Data: eventDetailData{
			SchemaVersion: event.SchemaVersion,
			ProjectID:     event.ProjectID,
			AppName:       event.AppName,
			BatchID:       event.BatchID,
			SendType:      event.SendType,
			SentAt:        event.SentAt.UnixMilli(),
			EventID:       event.EventID,
			Category:      event.Category,
			EventType:     event.EventType,
			Timestamp:     event.Timestamp.UnixMilli(),
			PageURL:       event.PageURL,
			UserID:        event.UserID,
			Level:         event.Level,
			Breadcrumbs:   event.Breadcrumbs,
			ReplayData:    event.ReplayData,
			Payload:       event.Payload,
			ReceivedAt:    event.ReceivedAt.UnixMilli(),
		},
	})
}

func writeEventDetailError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, eventquery.ErrProjectIDRequired):
		writeAPIError(
			c,
			http.StatusBadRequest,
			"INVALID_PATH",
			"projectId is required",
			&errorDetails{Field: "projectId"},
		)
	case errors.Is(err, eventquery.ErrInvalidEventID):
		writeAPIError(
			c,
			http.StatusBadRequest,
			"INVALID_PATH",
			"eventId is invalid",
			&errorDetails{Field: "eventId"},
		)
	case errors.Is(err, eventquery.ErrEventNotFound):
		writeAPIError(
			c,
			http.StatusNotFound,
			"EVENT_NOT_FOUND",
			"event was not found in the requested project",
			nil,
		)
	default:
		writeAPIError(
			c,
			http.StatusInternalServerError,
			"INTERNAL_ERROR",
			"server could not query the telemetry event",
			nil,
		)
	}
}

type eventDetailEnvelope struct {
	Data eventDetailData `json:"data"`
}

type eventDetailData struct {
	SchemaVersion int               `json:"schemaVersion"`
	ProjectID     string            `json:"projectId"`
	AppName       string            `json:"appName"`
	BatchID       string            `json:"batchId"`
	SendType      dto.SendType      `json:"sendType"`
	SentAt        int64             `json:"sentAt"`
	EventID       string            `json:"eventId"`
	Category      dto.EventCategory `json:"category"`
	EventType     string            `json:"eventType"`
	Timestamp     int64             `json:"timestamp"`
	PageURL       string            `json:"pageUrl"`
	UserID        *string           `json:"userId"`
	Level         *dto.EventLevel   `json:"level"`
	Breadcrumbs   json.RawMessage   `json:"breadcrumbs"`
	ReplayData    *string           `json:"replayData"`
	Payload       json.RawMessage   `json:"payload"`
	ReceivedAt    int64             `json:"receivedAt"`
}
