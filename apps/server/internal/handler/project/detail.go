package project

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
	"github.com/liu04919/monitor-platform/apps/server/internal/middleware"
	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
)

func (h *Handler) Detail(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		httpapi.WriteError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	foundProject, err := h.service.Get(c.Request.Context(), user.ID, c.Param("projectId"))
	if err != nil {
		if errors.Is(err, projectdomain.ErrProjectNotFound) {
			httpapi.WriteError(c, http.StatusNotFound, "PROJECT_NOT_FOUND", "project was not found", nil)
			return
		}

		httpapi.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not query project", nil)
		return
	}

	c.JSON(http.StatusOK, projectDetailEnvelope{
		Data: projectDetailData{
			ID:        foundProject.ID,
			Name:      foundProject.Name,
			Enabled:   foundProject.Enabled,
			CreatedAt: foundProject.CreatedAt.UnixMilli(),
			PublicKey: foundProject.PublicKey,
		},
	})
}

type projectDetailEnvelope struct {
	Data projectDetailData `json:"data"`
}

type projectDetailData struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	CreatedAt int64  `json:"createdAt"`
	PublicKey string `json:"publicKey"`
}
