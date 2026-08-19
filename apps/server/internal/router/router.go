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

type EventQueryHandler interface {
	List(c *gin.Context)
	Detail(c *gin.Context)
}

type ProjectQueryHandler interface {
	List(c *gin.Context)
}

// New 创建正式 HTTP Router，并分别注入上报与管理端读取能力。
func New(
	telemetryHandler TelemetryBatchHandler,
	projectQueryHandler ProjectQueryHandler,
	eventQueryHandler EventQueryHandler,
	managementToken string,
) *gin.Engine {
	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery())

	engine.GET("/healthz", handler.Health)

	telemetry := engine.Group("/api/v1/events")
	telemetry.Use(middleware.TelemetryCORS())
	telemetry.OPTIONS("/batch", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	telemetry.POST("/batch", telemetryHandler.Batch)

	management := engine.Group("/api/v1/projects")
	management.Use(middleware.ManagementAuth(managementToken))
	management.GET("", projectQueryHandler.List)
	management.GET("/:projectId/events", eventQueryHandler.List)
	management.GET("/:projectId/events/:eventId", eventQueryHandler.Detail)

	return engine
}
