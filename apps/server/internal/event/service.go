// event 包负责遥测事件的列表、详情、项目授权和页码分页规则。
package event

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

const maxIDLength = 128

var (
	ErrProjectIDRequired = errors.New("project ID is required")
	ErrInvalidCategory   = errors.New("invalid event category")
	ErrProjectNotFound   = errors.New("project not found")
)

// EventSummary 是事件列表需要的轻量字段；完整 payload 留给后续详情查询。
type EventSummary struct {
	BatchID    string
	SendType   telemetry.SendType
	EventID    string
	Category   telemetry.Category
	EventType  string
	Timestamp  time.Time
	PageURL    string
	UserID     *string
	Level      *telemetry.Level
	Message    string
	ReceivedAt time.Time
}

// ListFilter 是查询存储层使用的已校验条件。
type ListFilter struct {
	TimeRange telemetry.TimeRange
	ProjectID string
	Category  telemetry.Category
	EventType string
	Offset    int64
	Limit     int
}

// Store 从事件存储中按稳定顺序读取列表。
type Store interface {
	List(ctx context.Context, filter ListFilter) ([]EventSummary, uint64, error)
	Get(ctx context.Context, projectID, eventID string) (EventDetail, bool, error)
}

type ProjectAuthorizer interface {
	CanAccess(ctx context.Context, userID, projectID string) (bool, error)
}

type ListRequest struct {
	telemetry.Pagination
	TimeRange telemetry.TimeRange
	UserID    string
	ProjectID string
	Category  telemetry.Category
	EventType string
}

type ListPage struct {
	telemetry.PageInfo
	Events []EventSummary
}

type Service struct {
	store    Store
	projects ProjectAuthorizer
}

func NewService(store Store, projects ProjectAuthorizer) *Service {
	return &Service{store: store, projects: projects}
}

func (s *Service) List(ctx context.Context, request ListRequest) (ListPage, error) {
	projectID := strings.TrimSpace(request.ProjectID)
	if projectID == "" {
		return ListPage{}, ErrProjectIDRequired
	}
	if err := s.authorizeProject(ctx, request.UserID, projectID); err != nil {
		return ListPage{}, err
	}
	if request.Category != "" && !isSupportedCategory(request.Category) {
		return ListPage{}, ErrInvalidCategory
	}

	pagination, err := request.Pagination.Normalize()
	if err != nil {
		return ListPage{}, err
	}

	if err := request.TimeRange.Validate(); err != nil {
		return ListPage{}, err
	}
	events, total, err := s.store.List(ctx, ListFilter{
		TimeRange: request.TimeRange,
		ProjectID: projectID,
		Category:  request.Category,
		EventType: strings.TrimSpace(request.EventType),
		Offset:    pagination.Offset(),
		Limit:     pagination.PageSize,
	})
	if err != nil {
		return ListPage{}, fmt.Errorf("查询事件列表: %w", err)
	}

	return ListPage{PageInfo: pagination.Info(total), Events: events}, nil
}

func (s *Service) authorizeProject(ctx context.Context, userID, projectID string) error {
	owned, err := s.projects.CanAccess(ctx, strings.TrimSpace(userID), projectID)
	if err != nil {
		return fmt.Errorf("校验事件项目访问权限: %w", err)
	}
	if !owned {
		return ErrProjectNotFound
	}
	return nil
}

func isSupportedCategory(category telemetry.Category) bool {
	switch category {
	case telemetry.CategoryError,
		telemetry.CategoryPerformance,
		telemetry.CategoryBehavior,
		telemetry.CategoryStability,
		telemetry.CategoryAI:
		return true
	default:
		return false
	}
}
