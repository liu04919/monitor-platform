package project

import (
	"context"

	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
)

type Service interface {
	List(ctx context.Context, ownerUserID string) ([]projectdomain.ProjectSummary, error)
	Get(ctx context.Context, ownerUserID, projectID string) (projectdomain.Project, error)
	Create(ctx context.Context, ownerUserID string, request projectdomain.CreateRequest) (projectdomain.Project, error)
	Update(ctx context.Context, ownerUserID, projectID string, request projectdomain.UpdateRequest) (projectdomain.Project, error)
	RotatePublicKey(ctx context.Context, ownerUserID, projectID string) (projectdomain.Project, error)
}

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}
