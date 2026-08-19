package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/projectquery"
)

type ProjectQueryService interface {
	List(ctx context.Context) ([]projectquery.ProjectSummary, error)
}

type ProjectListHandler struct {
	service ProjectQueryService
}

func NewProjectListHandler(service ProjectQueryService) *ProjectListHandler {
	return &ProjectListHandler{service: service}
}

func (h *ProjectListHandler) List(c *gin.Context) {
	projects, err := h.service.List(c.Request.Context())
	if err != nil {
		writeAPIError(
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
