package event

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	eventdomain "github.com/liu04919/monitor-platform/apps/server/internal/event"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/middleware"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/response"
)

func (h *Handler) Detail(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		response.WriteError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	event, err := h.service.Detail(c.Request.Context(), eventdomain.DetailRequest{
		UserID:    user.ID,
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
			Message:       event.Message,
			Breadcrumbs:   event.Breadcrumbs,
			ReplayData:    event.ReplayData,
			Payload:       event.Payload,
			ReceivedAt:    event.ReceivedAt.UnixMilli(),
		},
	})
}

func writeEventDetailError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, eventdomain.ErrProjectIDRequired):
		response.WriteError(
			c,
			http.StatusBadRequest,
			"INVALID_PATH",
			"projectId is required",
			&response.ErrorDetails{Field: "projectId"},
		)
	case errors.Is(err, eventdomain.ErrInvalidEventID):
		response.WriteError(
			c,
			http.StatusBadRequest,
			"INVALID_PATH",
			"eventId is invalid",
			&response.ErrorDetails{Field: "eventId"},
		)
	case errors.Is(err, eventdomain.ErrEventNotFound):
		response.WriteError(
			c,
			http.StatusNotFound,
			"EVENT_NOT_FOUND",
			"event was not found in the requested project",
			nil,
		)
	case errors.Is(err, eventdomain.ErrProjectNotFound):
		response.WriteError(c, http.StatusNotFound, "PROJECT_NOT_FOUND", "project was not found", nil)
	default:
		response.WriteError(
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
	SchemaVersion int                `json:"schemaVersion"`
	ProjectID     string             `json:"projectId"`
	AppName       string             `json:"appName"`
	BatchID       string             `json:"batchId"`
	SendType      telemetry.SendType `json:"sendType"`
	SentAt        int64              `json:"sentAt"`
	EventID       string             `json:"eventId"`
	Category      telemetry.Category `json:"category"`
	EventType     string             `json:"eventType"`
	Timestamp     int64              `json:"timestamp"`
	PageURL       string             `json:"pageUrl"`
	UserID        *string            `json:"userId"`
	Level         *telemetry.Level   `json:"level"`
	Message       string             `json:"message"`
	Breadcrumbs   json.RawMessage    `json:"breadcrumbs"`
	ReplayData    *string            `json:"replayData"`
	Payload       json.RawMessage    `json:"payload"`
	ReceivedAt    int64              `json:"receivedAt"`
}
