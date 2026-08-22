package project

import (
	"context"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
)

type stubService struct {
	projects      []projectdomain.ProjectSummary
	err           error
	calls         int
	created       projectdomain.Project
	createErr     error
	createCalls   int
	createRequest projectdomain.CreateRequest
	ownerUserID   string
	foundProject  projectdomain.Project
	getErr        error
	getCalls      int
	projectID     string
}

func (s *stubService) List(_ context.Context, ownerUserID string) ([]projectdomain.ProjectSummary, error) {
	s.calls++
	s.ownerUserID = ownerUserID
	return s.projects, s.err
}

func (s *stubService) Get(
	_ context.Context,
	ownerUserID string,
	projectID string,
) (projectdomain.Project, error) {
	s.getCalls++
	s.ownerUserID = ownerUserID
	s.projectID = projectID
	return s.foundProject, s.getErr
}

func (s *stubService) Create(
	_ context.Context,
	ownerUserID string,
	request projectdomain.CreateRequest,
) (projectdomain.Project, error) {
	s.createCalls++
	s.ownerUserID = ownerUserID
	s.createRequest = request
	return s.created, s.createErr
}

type stubAuthenticator struct{}

func (stubAuthenticator) Authenticate(_ context.Context, _ string) (auth.User, error) {
	return auth.User{ID: "user-1", Email: "user@example.com"}, nil
}
