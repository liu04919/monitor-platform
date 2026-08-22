package issue

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
	"github.com/liu04919/monitor-platform/apps/server/internal/issuequery"
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
		writeQueryError(c, issuequery.ErrInvalidLimit)
		return
	}

	page, err := h.service.List(c.Request.Context(), issuequery.ListRequest{
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
		issues = append(issues, listItem{
			ID:            item.ID,
			Title:         item.Title,
			EventType:     item.EventType,
			ExceptionType: item.ExceptionType,
			EventCount:    item.EventCount,
			AffectedUsers: item.AffectedUsers,
			FirstSeen:     item.FirstSeen.UnixMilli(),
			LastSeen:      item.LastSeen.UnixMilli(),
			LatestEventID: item.LatestEventID,
			LatestPageURL: item.LatestPageURL,
		})
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
	if err != nil || limit < 1 || limit > issuequery.MaxLimit {
		return 0, issuequery.ErrInvalidLimit
	}

	return limit, nil
}

func writeListError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, issuequery.ErrProjectIDRequired):
		writeQueryError(c, issuequery.ErrProjectIDRequired)
	case errors.Is(err, issuequery.ErrInvalidLimit):
		writeQueryError(c, issuequery.ErrInvalidLimit)
	case errors.Is(err, issuequery.ErrInvalidCursor):
		writeQueryError(c, issuequery.ErrInvalidCursor)
	case errors.Is(err, issuequery.ErrProjectNotFound):
		httpapi.WriteError(c, http.StatusNotFound, "PROJECT_NOT_FOUND", "project was not found", nil)
	default:
		httpapi.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not query issues", nil)
	}
}

func writeQueryError(c *gin.Context, err error) {
	field := ""
	message := "query parameters are invalid"

	switch {
	case errors.Is(err, issuequery.ErrProjectIDRequired):
		field = "projectId"
		message = "projectId is required"
	case errors.Is(err, issuequery.ErrInvalidLimit):
		field = "limit"
		message = "limit must be an integer between 1 and 100"
	case errors.Is(err, issuequery.ErrInvalidCursor):
		field = "cursor"
		message = "cursor is invalid"
	}

	httpapi.WriteError(c, http.StatusBadRequest, "INVALID_QUERY", message, &httpapi.ErrorDetails{Field: field})
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
