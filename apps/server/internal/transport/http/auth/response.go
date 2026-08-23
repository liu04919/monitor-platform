package auth

import (
	"github.com/gin-gonic/gin"

	authdomain "github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

func writeUser(c *gin.Context, status int, user authdomain.User) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, userEnvelope{Data: userData{
		ID:        user.ID,
		Email:     user.Email,
		CreatedAt: user.CreatedAt.UnixMilli(),
	}})
}

type userEnvelope struct {
	Data userData `json:"data"`
}

type userData struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	CreatedAt int64  `json:"createdAt"`
}
