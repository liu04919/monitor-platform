package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ManagementAuth 使用独立的 Bearer Token 保护管理端读取接口。
// 浏览器 SDK 的 publicKey 只用于事件上报，不能通过这里的校验。
func ManagementAuth(expectedToken string) gin.HandlerFunc {
	expectedHash := sha256.Sum256([]byte(expectedToken))

	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		token, ok := bearerToken(c.GetHeader("Authorization"))
		actualHash := sha256.Sum256([]byte(token))
		validToken := subtle.ConstantTimeCompare(actualHash[:], expectedHash[:]) == 1
		if !ok || !validToken {
			c.Header("WWW-Authenticate", "Bearer")
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{
					"code":    "UNAUTHORIZED",
					"message": "a valid management Bearer token is required",
				},
			})
			return
		}

		c.Next()
	}
}

func bearerToken(value string) (string, bool) {
	scheme, token, ok := strings.Cut(strings.TrimSpace(value), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" || strings.Contains(token, " ") {
		return "", false
	}

	return token, true
}
