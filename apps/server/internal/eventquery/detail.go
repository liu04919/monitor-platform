package eventquery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

var (
	ErrInvalidEventID = errors.New("invalid event ID")
	ErrEventNotFound  = errors.New("event not found")
)

type DetailRequest struct {
	UserID    string
	ProjectID string
	EventID   string
}

// EventDetail 是管理端详情页需要的完整事件，其中 JSON 字段保持结构化值。
type EventDetail struct {
	SchemaVersion int
	ProjectID     string
	AppName       string
	BatchID       string
	SendType      dto.SendType
	SentAt        time.Time
	EventID       string
	Category      dto.EventCategory
	EventType     string
	Timestamp     time.Time
	PageURL       string
	UserID        *string
	Level         *dto.EventLevel
	Message       string
	Breadcrumbs   json.RawMessage
	ReplayData    *string
	Payload       json.RawMessage
	ReceivedAt    time.Time
}

func (s *Service) Detail(ctx context.Context, request DetailRequest) (EventDetail, error) {
	projectID := strings.TrimSpace(request.ProjectID)
	if projectID == "" {
		return EventDetail{}, ErrProjectIDRequired
	}
	if err := s.authorizeProject(ctx, request.UserID, projectID); err != nil {
		return EventDetail{}, err
	}

	eventID := strings.TrimSpace(request.EventID)
	if eventID == "" || utf8.RuneCountInString(eventID) > maxIDLength {
		return EventDetail{}, ErrInvalidEventID
	}

	event, found, err := s.store.Get(ctx, projectID, eventID)
	if err != nil {
		return EventDetail{}, fmt.Errorf("查询事件详情: %w", err)
	}
	if !found {
		return EventDetail{}, ErrEventNotFound
	}

	return event, nil
}
