package event

import (
	"context"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
	"github.com/liu04919/monitor-platform/apps/server/internal/eventquery"
)

type stubService struct {
	page          eventquery.ListPage
	err           error
	calls         int
	request       eventquery.ListRequest
	detail        eventquery.EventDetail
	detailErr     error
	detailCalls   int
	detailRequest eventquery.DetailRequest
}

func (s *stubService) Detail(
	_ context.Context,
	request eventquery.DetailRequest,
) (eventquery.EventDetail, error) {
	s.detailCalls++
	s.detailRequest = request
	return s.detail, s.detailErr
}

func (s *stubService) List(
	_ context.Context,
	request eventquery.ListRequest,
) (eventquery.ListPage, error) {
	s.calls++
	s.request = request
	return s.page, s.err
}

type stubAuthenticator struct{}

func (stubAuthenticator) Authenticate(_ context.Context, _ string) (auth.User, error) {
	return auth.User{ID: "user-1", Email: "user@example.com"}, nil
}
