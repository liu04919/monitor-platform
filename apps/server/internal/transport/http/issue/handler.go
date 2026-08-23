package issue

import (
	"context"

	issuedomain "github.com/liu04919/monitor-platform/apps/server/internal/issue"
)

type Service interface {
	List(ctx context.Context, request issuedomain.ListRequest) (issuedomain.ListPage, error)
	Detail(ctx context.Context, request issuedomain.DetailRequest) (issuedomain.DetailPage, error)
}

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}
