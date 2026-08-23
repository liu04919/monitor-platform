package event

import (
	"context"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
	eventdomain "github.com/liu04919/monitor-platform/apps/server/internal/event"
)

type stubService struct {
	page          eventdomain.ListPage
	err           error
	calls         int
	request       eventdomain.ListRequest
	detail        eventdomain.EventDetail
	detailErr     error
	detailCalls   int
	detailRequest eventdomain.DetailRequest
}

func (s *stubService) Detail(
	_ context.Context,
	request eventdomain.DetailRequest,
) (eventdomain.EventDetail, error) {
	s.detailCalls++
	s.detailRequest = request
	return s.detail, s.detailErr
}

func (s *stubService) List(
	_ context.Context,
	request eventdomain.ListRequest,
) (eventdomain.ListPage, error) {
	s.calls++
	s.request = request
	return s.page, s.err
}

type stubAuthenticator struct{}

func (stubAuthenticator) Authenticate(_ context.Context, _ string) (auth.User, error) {
	return auth.User{ID: "user-1", Email: "user@example.com"}, nil
}
