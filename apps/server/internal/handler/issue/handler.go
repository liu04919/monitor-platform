package issue

import (
	"context"

	"github.com/liu04919/monitor-platform/apps/server/internal/issuequery"
)

type Service interface {
	List(ctx context.Context, request issuequery.ListRequest) (issuequery.ListPage, error)
}

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}
