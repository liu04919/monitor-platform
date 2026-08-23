package project

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/middleware"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/response"
)

func (h *Handler) RotatePublicKey(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		response.WriteError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	updatedProject, err := h.service.RotatePublicKey(
		c.Request.Context(),
		user.ID,
		c.Param("projectId"),
	)
	if err != nil {
		if errors.Is(err, projectdomain.ErrProjectNotFound) {
			response.WriteError(c, http.StatusNotFound, "PROJECT_NOT_FOUND", "project was not found", nil)
			return
		}

		response.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not rotate project public key", nil)
		return
	}

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, projectDetailEnvelope{
		Data: projectDetailData{
			ID:        updatedProject.ID,
			Name:      updatedProject.Name,
			Enabled:   updatedProject.Enabled,
			CreatedAt: updatedProject.CreatedAt.UnixMilli(),
			PublicKey: updatedProject.PublicKey,
		},
	})
}
