package event

import (
	"context"

	"github.com/liu04919/monitor-platform/apps/server/internal/eventquery"
)

type Service interface {
	List(ctx context.Context, request eventquery.ListRequest) (eventquery.ListPage, error)
	Detail(ctx context.Context, request eventquery.DetailRequest) (eventquery.EventDetail, error)
}

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}
