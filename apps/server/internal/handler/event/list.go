package event

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/eventquery"
	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
	"github.com/liu04919/monitor-platform/apps/server/internal/middleware"
)

func (h *Handler) List(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		httpapi.WriteError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	limit, err := parseOptionalLimit(c.Query("limit"))
	if err != nil {
		writeEventListQueryError(c, eventquery.ErrInvalidLimit)
		return
	}

	page, err := h.service.List(c.Request.Context(), eventquery.ListRequest{
		UserID:    user.ID,
		ProjectID: c.Param("projectId"),
		Category:  dto.EventCategory(c.Query("category")),
		EventType: c.Query("eventType"),
		Limit:     limit,
		Cursor:    c.Query("cursor"),
	})
	if err != nil {
		writeEventListError(c, err)
		return
	}

	events := make([]eventListItem, 0, len(page.Events))
	for _, event := range page.Events {
		events = append(events, eventListItem{
			BatchID:    event.BatchID,
			SendType:   event.SendType,
			EventID:    event.EventID,
			Category:   event.Category,
			EventType:  event.EventType,
			Timestamp:  event.Timestamp.UnixMilli(),
			PageURL:    event.PageURL,
			UserID:     event.UserID,
			Level:      event.Level,
			Message:    event.Message,
			ReceivedAt: event.ReceivedAt.UnixMilli(),
		})
	}

	c.JSON(http.StatusOK, eventListEnvelope{
		Data: eventListData{
			Events:     events,
			NextCursor: page.NextCursor,
		},
	})
}

func parseOptionalLimit(value string) (int, error) {
	if value == "" {
		return 0, nil
	}

	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 || limit > eventquery.MaxLimit {
		return 0, eventquery.ErrInvalidLimit
	}

	return limit, nil
}

func writeEventListError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, eventquery.ErrProjectIDRequired):
		writeEventListQueryError(c, eventquery.ErrProjectIDRequired)
	case errors.Is(err, eventquery.ErrInvalidCategory):
		writeEventListQueryError(c, eventquery.ErrInvalidCategory)
	case errors.Is(err, eventquery.ErrInvalidLimit):
		writeEventListQueryError(c, eventquery.ErrInvalidLimit)
	case errors.Is(err, eventquery.ErrInvalidCursor):
		writeEventListQueryError(c, eventquery.ErrInvalidCursor)
	case errors.Is(err, eventquery.ErrProjectNotFound):
		httpapi.WriteError(c, http.StatusNotFound, "PROJECT_NOT_FOUND", "project was not found", nil)
	default:
		httpapi.WriteError(
			c,
			http.StatusInternalServerError,
			"INTERNAL_ERROR",
			"server could not query telemetry events",
			nil,
		)
	}
}

func writeEventListQueryError(c *gin.Context, err error) {
	field := ""
	message := "query parameters are invalid"

	switch {
	case errors.Is(err, eventquery.ErrProjectIDRequired):
		field = "projectId"
		message = "projectId is required"
	case errors.Is(err, eventquery.ErrInvalidCategory):
		field = "category"
		message = "category is not supported"
	case errors.Is(err, eventquery.ErrInvalidLimit):
		field = "limit"
		message = "limit must be an integer between 1 and 100"
	case errors.Is(err, eventquery.ErrInvalidCursor):
		field = "cursor"
		message = "cursor is invalid"
	}

	httpapi.WriteError(
		c,
		http.StatusBadRequest,
		"INVALID_QUERY",
		message,
		&httpapi.ErrorDetails{Field: field},
	)
}

type eventListEnvelope struct {
	Data eventListData `json:"data"`
}

type eventListData struct {
	Events     []eventListItem `json:"events"`
	NextCursor string          `json:"nextCursor"`
}

type eventListItem struct {
	BatchID    string            `json:"batchId"`
	SendType   dto.SendType      `json:"sendType"`
	EventID    string            `json:"eventId"`
	Category   dto.EventCategory `json:"category"`
	EventType  string            `json:"eventType"`
	Timestamp  int64             `json:"timestamp"`
	PageURL    string            `json:"pageUrl"`
	UserID     *string           `json:"userId"`
	Level      *dto.EventLevel   `json:"level"`
	Message    string            `json:"message"`
	ReceivedAt int64             `json:"receivedAt"`
}
