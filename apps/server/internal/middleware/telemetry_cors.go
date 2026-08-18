// middleware 包提供 HTTP 请求进入业务 Handler 前的通用处理。
package middleware

import "github.com/gin-gonic/gin"

// TelemetryCORS 允许浏览器使用不携带凭证的 Fetch 或 Beacon 跨域上报。
// publicKey 仍由 ingestion service 校验，CORS 本身不承担鉴权职责。
func TelemetryCORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		c.Header("Access-Control-Max-Age", "600")

		c.Next()
	}
}
