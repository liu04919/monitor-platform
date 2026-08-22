// httpapi 包提供各 HTTP Handler 共享的协议响应工具，不包含业务逻辑。
package httpapi

import (
	"mime"

	"github.com/gin-gonic/gin"
)

type ErrorEnvelope struct {
	Error Error `json:"error"`
}

type Error struct {
	Code    string        `json:"code"`
	Message string        `json:"message"`
	Details *ErrorDetails `json:"details,omitempty"`
}

type ErrorDetails struct {
	Field string `json:"field"`
}

func WriteError(c *gin.Context, status int, code, message string, details *ErrorDetails) {
	c.JSON(status, ErrorEnvelope{
		Error: Error{
			Code:    code,
			Message: message,
			Details: details,
		},
	})
}

func IsJSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	return err == nil && mediaType == "application/json"
}
