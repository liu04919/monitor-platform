package event

import (
	"context"

	eventdomain "github.com/liu04919/monitor-platform/apps/server/internal/event"
)

type Service interface {
	List(ctx context.Context, request eventdomain.ListRequest) (eventdomain.ListPage, error)
	Detail(ctx context.Context, request eventdomain.DetailRequest) (eventdomain.EventDetail, error)
}

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}
