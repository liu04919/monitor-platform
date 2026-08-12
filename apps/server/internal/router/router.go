package router

import (
	"github.com/gin-gonic/gin"

	"github.com/liu04919/monitor-platform/apps/server/internal/handler"
)

func New() *gin.Engine {
	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery())

	engine.GET("/healthz", handler.Health)

	return engine
}
