package issue

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	issuedomain "github.com/liu04919/monitor-platform/apps/server/internal/issue"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/middleware"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/response"
)

func (h *Handler) List(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		response.WriteError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	limit, err := parseOptionalLimit(c.Query("limit"))
	if err != nil {
		writeQueryError(c, issuedomain.ErrInvalidLimit)
		return
	}

	timeRange, err := telemetry.ParseTimeRange(c.Query("from"), c.Query("to"))
	if err != nil {
		writeQueryError(c, err)
		return
	}
	page, err := h.service.List(c.Request.Context(), issuedomain.ListRequest{
		TimeRange: timeRange,
		UserID:    user.ID,
		ProjectID: c.Param("projectId"),
		Limit:     limit,
		Cursor:    c.Query("cursor"),
	})
	if err != nil {
		writeListError(c, err)
		return
	}

	issues := make([]listItem, 0, len(page.Issues))
	for _, item := range page.Issues {
		issues = append(issues, summaryItem(item))
	}

	c.JSON(http.StatusOK, listEnvelope{Data: listData{
		Issues:     issues,
		NextCursor: page.NextCursor,
	}})
}

func parseOptionalLimit(value string) (int, error) {
	if value == "" {
		return 0, nil
	}

	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 || limit > issuedomain.MaxLimit {
		return 0, issuedomain.ErrInvalidLimit
	}

	return limit, nil
}

func writeListError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, telemetry.ErrInvalidTimeRange):
		writeQueryError(c, err)
	case errors.Is(err, issuedomain.ErrProjectIDRequired):
		writeQueryError(c, issuedomain.ErrProjectIDRequired)
	case errors.Is(err, issuedomain.ErrInvalidLimit):
		writeQueryError(c, issuedomain.ErrInvalidLimit)
	case errors.Is(err, issuedomain.ErrInvalidCursor):
		writeQueryError(c, issuedomain.ErrInvalidCursor)
	case errors.Is(err, issuedomain.ErrProjectNotFound):
		response.WriteError(c, http.StatusNotFound, "PROJECT_NOT_FOUND", "project was not found", nil)
	default:
		response.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not query issues", nil)
	}
}

func writeQueryError(c *gin.Context, err error) {
	field := ""
	message := "query parameters are invalid"

	switch {
	case errors.Is(err, telemetry.ErrInvalidTimeRange):
		field = "timeRange"
		message = telemetry.ErrInvalidTimeRange.Error()
	case errors.Is(err, issuedomain.ErrProjectIDRequired):
		field = "projectId"
		message = "projectId is required"
	case errors.Is(err, issuedomain.ErrInvalidLimit):
		field = "limit"
		message = "limit must be an integer between 1 and 100"
	case errors.Is(err, issuedomain.ErrInvalidCursor):
		field = "cursor"
		message = "cursor is invalid"
	}

	response.WriteError(c, http.StatusBadRequest, "INVALID_QUERY", message, &response.ErrorDetails{Field: field})
}

type listEnvelope struct {
	Data listData `json:"data"`
}

type listData struct {
	Issues     []listItem `json:"issues"`
	NextCursor string     `json:"nextCursor"`
}

type listItem struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	EventType     string `json:"eventType"`
	ExceptionType string `json:"exceptionType"`
	EventCount    uint64 `json:"eventCount"`
	AffectedUsers uint64 `json:"affectedUsers"`
	FirstSeen     int64  `json:"firstSeen"`
	LastSeen      int64  `json:"lastSeen"`
	LatestEventID string `json:"latestEventId"`
	LatestPageURL string `json:"latestPageUrl"`
}
