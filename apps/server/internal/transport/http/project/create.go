package project

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/middleware"
	"github.com/liu04919/monitor-platform/apps/server/internal/transport/http/response"
)

func (h *Handler) Create(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		response.WriteError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	if !response.IsJSONContentType(c.GetHeader("Content-Type")) {
		response.WriteError(
			c,
			http.StatusUnsupportedMediaType,
			"UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json",
			nil,
		)
		return
	}

	var request createProjectRequest
	if err := decodeProjectRequest(c, &request); err != nil {
		writeProjectDecodeError(c, err)
		return
	}

	createdProject, err := h.service.Create(c.Request.Context(), user.ID, projectdomain.CreateRequest{
		Name: request.Name,
	})
	if err != nil {
		writeProjectCreateError(c, err)
		return
	}

	c.JSON(http.StatusCreated, projectCreateEnvelope{
		Data: projectCreateData{
			ID:        createdProject.ID,
			Name:      createdProject.Name,
			Enabled:   createdProject.Enabled,
			CreatedAt: createdProject.CreatedAt.UnixMilli(),
			PublicKey: createdProject.PublicKey,
		},
	})
}

func writeProjectCreateError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, projectdomain.ErrInvalidProjectName):
		response.WriteError(
			c,
			http.StatusUnprocessableEntity,
			"INVALID_PROJECT",
			"name is required and must not exceed 128 characters",
			&response.ErrorDetails{Field: "name"},
		)
	default:
		response.WriteError(
			c,
			http.StatusInternalServerError,
			"INTERNAL_ERROR",
			"server could not create project",
			nil,
		)
	}
}

type createProjectRequest struct {
	Name string `json:"name"`
}

type projectCreateEnvelope struct {
	Data projectCreateData `json:"data"`
}

type projectCreateData struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	CreatedAt int64  `json:"createdAt"`
	PublicKey string `json:"publicKey"`
}
