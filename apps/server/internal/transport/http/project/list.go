package project

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/middleware"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/response"
)

func (h *Handler) List(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		response.WriteError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	projects, err := h.service.List(c.Request.Context(), user.ID)
	if err != nil {
		response.WriteError(
			c,
			http.StatusInternalServerError,
			"INTERNAL_ERROR",
			"server could not query projects",
			nil,
		)
		return
	}

	items := make([]projectListItem, 0, len(projects))
	for _, project := range projects {
		items = append(items, projectListItem{
			ID:        project.ID,
			Name:      project.Name,
			Enabled:   project.Enabled,
			CreatedAt: project.CreatedAt.UnixMilli(),
		})
	}

	c.JSON(http.StatusOK, projectListEnvelope{
		Data: projectListData{Projects: items},
	})
}

type projectListEnvelope struct {
	Data projectListData `json:"data"`
}

type projectListData struct {
	Projects []projectListItem `json:"projects"`
}

type projectListItem struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	CreatedAt int64  `json:"createdAt"`
}
