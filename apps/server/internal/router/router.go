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

type ProjectHandler interface {
	List(c *gin.Context)
	Create(c *gin.Context)
}

type AuthHandler interface {
	Register(c *gin.Context)
	Login(c *gin.Context)
	Me(c *gin.Context)
	Logout(c *gin.Context)
}

// New 创建正式 HTTP Router，并分别注入上报、项目管理与事件读取能力。
func New(
	telemetryHandler TelemetryBatchHandler,
	projectHandler ProjectHandler,
	eventQueryHandler EventQueryHandler,
	authHandler AuthHandler,
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

	auth := engine.Group("/api/v1/auth")
	auth.POST("/register", authHandler.Register)
	auth.POST("/login", authHandler.Login)
	auth.GET("/me", authHandler.Me)
	auth.DELETE("/logout", authHandler.Logout)

	management := engine.Group("/api/v1/projects")
	management.Use(middleware.ManagementAuth(managementToken))
	management.GET("", projectHandler.List)
	management.POST("", projectHandler.Create)
	management.GET("/:projectId/events", eventQueryHandler.List)
	management.GET("/:projectId/events/:eventId", eventQueryHandler.Detail)

	return engine
}
