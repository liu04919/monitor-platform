package project

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
	"github.com/liu04919/monitor-platform/apps/server/internal/middleware"
	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
)

func (h *Handler) Update(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		httpapi.WriteError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	if !httpapi.IsJSONContentType(c.GetHeader("Content-Type")) {
		httpapi.WriteError(
			c,
			http.StatusUnsupportedMediaType,
			"UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json",
			nil,
		)
		return
	}

	var request updateProjectRequest
	if err := decodeProjectRequest(c, &request); err != nil {
		writeProjectDecodeError(c, err)
		return
	}

	updatedProject, err := h.service.Update(
		c.Request.Context(),
		user.ID,
		c.Param("projectId"),
		projectdomain.UpdateRequest{Name: request.Name, Enabled: request.Enabled},
	)
	if err != nil {
		writeProjectUpdateError(c, err)
		return
	}

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

func writeProjectUpdateError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, projectdomain.ErrProjectNotFound):
		httpapi.WriteError(c, http.StatusNotFound, "PROJECT_NOT_FOUND", "project was not found", nil)
	case errors.Is(err, projectdomain.ErrInvalidProjectName):
		httpapi.WriteError(
			c,
			http.StatusUnprocessableEntity,
			"INVALID_PROJECT",
			"name is required and must not exceed 128 characters",
			&httpapi.ErrorDetails{Field: "name"},
		)
	case errors.Is(err, projectdomain.ErrNoProjectUpdates):
		httpapi.WriteError(
			c,
			http.StatusUnprocessableEntity,
			"INVALID_PROJECT",
			"request must update name or enabled",
			nil,
		)
	default:
		httpapi.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "server could not update project", nil)
	}
}

type updateProjectRequest struct {
	Name    *string `json:"name"`
	Enabled *bool   `json:"enabled"`
}
