package project

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/httpapi"
)

const maxProjectBodyBytes int64 = 4 << 10

func decodeProjectRequest(c *gin.Context, request any) error {
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

func writeProjectDecodeError(c *gin.Context, err error) {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		httpapi.WriteError(
			c,
			http.StatusRequestEntityTooLarge,
			"PAYLOAD_TOO_LARGE",
			"request body must not exceed 4 KiB",
			nil,
		)
		return
	}

	httpapi.WriteError(
		c,
		http.StatusBadRequest,
		"MALFORMED_JSON",
		"request body must contain exactly one valid project JSON value",
		nil,
	)
}
