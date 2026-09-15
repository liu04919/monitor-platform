package issue

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	issuedomain "github.com/liu04919/monitor-platform/apps/server/internal/issue"
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
	page, err := h.service.Detail(c.Request.Context(), issuedomain.DetailRequest{
		TimeRange: timeRange,
		UserID:    user.ID,
		ProjectID: c.Param("projectId"),
		IssueID:   c.Param("issueId"),
		Limit:     limit,
		Cursor:    c.Query("cursor"),
	})
	if err != nil {
		writeDetailError(c, err)
		return
	}

	occurrences := make([]occurrenceItem, 0, len(page.Occurrences))
	for _, occurrence := range page.Occurrences {
		occurrences = append(occurrences, occurrenceItem{
			EventID:    occurrence.EventID,
			EventType:  occurrence.EventType,
			Timestamp:  occurrence.Timestamp.UnixMilli(),
			PageURL:    occurrence.PageURL,
			UserID:     occurrence.UserID,
			Message:    occurrence.Message,
			ReceivedAt: occurrence.ReceivedAt.UnixMilli(),
		})
	}

	c.JSON(http.StatusOK, detailEnvelope{Data: detailData{
		Issue:       summaryItem(page.Issue),
		Occurrences: occurrences,
		NextCursor:  page.NextCursor,
	}})
}

func writeDetailError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, issuedomain.ErrProjectIDRequired):
		response.WriteError(c, http.StatusBadRequest, "INVALID_PATH", "projectId is required", &response.ErrorDetails{Field: "projectId"})
	case errors.Is(err, issuedomain.ErrInvalidIssueID):
		response.WriteError(c, http.StatusBadRequest, "INVALID_PATH", "issueId is invalid", &response.ErrorDetails{Field: "issueId"})
	case errors.Is(err, telemetry.ErrInvalidTimeRange), errors.Is(err, issuedomain.ErrInvalidLimit), errors.Is(err, issuedomain.ErrInvalidCursor):
		writeQueryError(c, err)
	case errors.Is(err, issuedomain.ErrIssueNotFound):
		response.WriteError(c, http.StatusNotFound, "ISSUE_NOT_FOUND", "issue was not found in the requested project", nil)
	case errors.Is(err, issuedomain.ErrProjectNotFound):
		response.WriteError(c, http.StatusNotFound, "PROJECT_NOT_FOUND", "project was not found", nil)
	default:
		response.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not query the issue", nil)
	}
}

func summaryItem(summary issuedomain.Summary) listItem {
	return listItem{
		ID:            summary.ID,
		Title:         summary.Title,
		EventType:     summary.EventType,
		ExceptionType: summary.ExceptionType,
		EventCount:    summary.EventCount,
		AffectedUsers: summary.AffectedUsers,
		FirstSeen:     summary.FirstSeen.UnixMilli(),
		LastSeen:      summary.LastSeen.UnixMilli(),
		LatestEventID: summary.LatestEventID,
		LatestPageURL: summary.LatestPageURL,
	}
}

type detailEnvelope struct {
	Data detailData `json:"data"`
}

type detailData struct {
	Issue       listItem         `json:"issue"`
	Occurrences []occurrenceItem `json:"occurrences"`
	NextCursor  string           `json:"nextCursor"`
}

type occurrenceItem struct {
	EventID    string  `json:"eventId"`
	EventType  string  `json:"eventType"`
	Timestamp  int64   `json:"timestamp"`
	PageURL    string  `json:"pageUrl"`
	UserID     *string `json:"userId"`
	Message    string  `json:"message"`
	ReceivedAt int64   `json:"receivedAt"`
}
