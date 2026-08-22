package auth

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
)

func (h *Handler) decodeCredentials(c *gin.Context) (credentialsRequest, bool) {
	c.Header("Cache-Control", "no-store")
	if !httpapi.IsJSONContentType(c.GetHeader("Content-Type")) {
		httpapi.WriteError(c, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", nil)
		return credentialsRequest{}, false
	}

	var request credentialsRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeDecodeError(c, err)
		return credentialsRequest{}, false
	}

	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("request body contains more than one JSON value")
		}
		writeDecodeError(c, err)
		return credentialsRequest{}, false
	}

	return request, true
}

func writeDecodeError(c *gin.Context, err error) {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		httpapi.WriteError(c, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "request body must not exceed 4 KiB", nil)
		return
	}

	httpapi.WriteError(c, http.StatusBadRequest, "MALFORMED_JSON", "request body must contain exactly one valid credentials JSON value", nil)
}

type credentialsRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
