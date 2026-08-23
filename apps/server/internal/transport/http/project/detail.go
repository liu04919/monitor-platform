package project

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/middleware"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/response"
)

func (h *Handler) Detail(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		response.WriteError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	foundProject, err := h.service.Get(c.Request.Context(), user.ID, c.Param("projectId"))
	if err != nil {
		if errors.Is(err, projectdomain.ErrProjectNotFound) {
			response.WriteError(c, http.StatusNotFound, "PROJECT_NOT_FOUND", "project was not found", nil)
			return
		}

		response.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not query project", nil)
		return
	}

	c.Header("Cache-Control", "no-store")
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
