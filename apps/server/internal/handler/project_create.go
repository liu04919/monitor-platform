package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/middleware"
	"github.com/liu04919/monitor-platform/apps/server/internal/project"
)

const maxProjectBodyBytes int64 = 4 << 10

func (h *ProjectHandler) Create(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		writeAPIError(c, http.StatusInternalServerError, "AUTH_CONTEXT_MISSING", "authenticated user context is missing", nil)
		return
	}

	if !isJSONContentType(c.GetHeader("Content-Type")) {
		writeAPIError(
			c,
			http.StatusUnsupportedMediaType,
			"UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json",
			nil,
		)
		return
	}

	var request createProjectRequest
	if err := decodeCreateProjectRequest(c, &request); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeAPIError(
				c,
				http.StatusRequestEntityTooLarge,
				"PAYLOAD_TOO_LARGE",
				"request body must not exceed 4 KiB",
				nil,
			)
			return
		}

		writeAPIError(
			c,
			http.StatusBadRequest,
			"MALFORMED_JSON",
			"request body must contain exactly one valid project JSON value",
			nil,
		)
		return
	}

	createdProject, err := h.service.Create(c.Request.Context(), user.ID, project.CreateRequest{
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
	case errors.Is(err, project.ErrInvalidProjectName):
		writeAPIError(
			c,
			http.StatusUnprocessableEntity,
			"INVALID_PROJECT",
			"name is required and must not exceed 128 characters",
			&errorDetails{Field: "name"},
		)
	default:
		writeAPIError(
			c,
			http.StatusInternalServerError,
			"INTERNAL_ERROR",
			"server could not create project",
			nil,
		)
	}
}

func isJSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	return err == nil && mediaType == "application/json"
}

func decodeCreateProjectRequest(c *gin.Context, request *createProjectRequest) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxProjectBodyBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(request); err != nil {
		return err
	}

	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body contains more than one JSON value")
		}
		return err
	}

	return nil
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
