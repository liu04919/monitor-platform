package router

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/handler"
	"github.com/liu04919/monitor-platform/apps/server/internal/middleware"
)

// TelemetryBatchHandler 描述 Router 注册批量上报端点所需的最小能力。
type TelemetryBatchHandler interface {
	Batch(c *gin.Context)
}

// New 创建正式 HTTP Router，并注入遥测批次 Handler。
func New(telemetryHandler TelemetryBatchHandler) *gin.Engine {
	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery())

	engine.GET("/healthz", handler.Health)

	telemetry := engine.Group("/api/v1/events")
	telemetry.Use(middleware.TelemetryCORS())
	telemetry.OPTIONS("/batch", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	telemetry.POST("/batch", telemetryHandler.Batch)

	return engine
}
