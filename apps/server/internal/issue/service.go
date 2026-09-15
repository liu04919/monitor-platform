// issue 包负责稳定错误指纹、Issue 聚合、项目授权和页码分页规则。
package issue

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

const fingerprintLength = 32

var (
	ErrProjectIDRequired = errors.New("project ID is required")
	ErrInvalidIssueID    = errors.New("invalid issue ID")
	ErrIssueNotFound     = errors.New("issue not found")
	ErrProjectNotFound   = errors.New("project not found")
)

// Summary 是 Issue 列表所需的聚合摘要，ID 等于稳定的错误指纹。
type Summary struct {
	ID            string
	Title         string
	EventType     string
	ExceptionType string
	EventCount    uint64
	AffectedUsers uint64
	FirstSeen     time.Time
	LastSeen      time.Time
	LatestEventID string
	LatestPageURL string
}

// Occurrence 是一个 Issue 下的单次错误事件摘要。
type Occurrence struct {
	EventID    string
	EventType  string
	Timestamp  time.Time
	PageURL    string
	UserID     *string
	Message    string
	ReceivedAt time.Time
}

type ListFilter struct {
	TimeRange telemetry.TimeRange
	ProjectID string
	Offset    int64
	Limit     int
}

type OccurrenceFilter struct {
	TimeRange telemetry.TimeRange
	ProjectID string
	IssueID   string
	Offset    int64
	Limit     int
}

type Store interface {
	ListIssues(ctx context.Context, filter ListFilter) ([]Summary, uint64, error)
	GetIssue(ctx context.Context, projectID, issueID string, timeRange telemetry.TimeRange) (Summary, bool, error)
	ListOccurrences(ctx context.Context, filter OccurrenceFilter) ([]Occurrence, error)
}

type ProjectAuthorizer interface {
	CanAccess(ctx context.Context, userID, projectID string) (bool, error)
}

type ListRequest struct {
	telemetry.Pagination
	TimeRange telemetry.TimeRange
	UserID    string
	ProjectID string
}

type ListPage struct {
	Issues []Summary
	telemetry.PageInfo
}

type DetailRequest struct {
	telemetry.Pagination
	TimeRange telemetry.TimeRange
	UserID    string
	ProjectID string
	IssueID   string
}

type DetailPage struct {
	Issue       Summary
	Occurrences []Occurrence
	telemetry.PageInfo
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

	owned, err := s.projects.CanAccess(ctx, strings.TrimSpace(request.UserID), projectID)
	if err != nil {
		return ListPage{}, fmt.Errorf("校验 Issue 项目访问权限: %w", err)
	}
	if !owned {
		return ListPage{}, ErrProjectNotFound
	}

	pagination, err := request.Pagination.Normalize()
	if err != nil {
		return ListPage{}, err
	}

	if err := request.TimeRange.Validate(); err != nil {
		return ListPage{}, err
	}
	issues, total, err := s.store.ListIssues(ctx, ListFilter{
		TimeRange: request.TimeRange,
		ProjectID: projectID,
		Offset:    pagination.Offset(),
		Limit:     pagination.PageSize,
	})
	if err != nil {
		return ListPage{}, fmt.Errorf("查询 Issue 列表: %w", err)
	}

	return ListPage{PageInfo: pagination.Info(total), Issues: issues}, nil
}

func (s *Service) Detail(ctx context.Context, request DetailRequest) (DetailPage, error) {
	projectID := strings.TrimSpace(request.ProjectID)
	if projectID == "" {
		return DetailPage{}, ErrProjectIDRequired
	}

	owned, err := s.projects.CanAccess(ctx, strings.TrimSpace(request.UserID), projectID)
	if err != nil {
		return DetailPage{}, fmt.Errorf("校验 Issue 项目访问权限: %w", err)
	}
	if !owned {
		return DetailPage{}, ErrProjectNotFound
	}

	issueID := strings.TrimSpace(request.IssueID)
	if !isValidIssueID(issueID) {
		return DetailPage{}, ErrInvalidIssueID
	}

	pagination, err := request.Pagination.Normalize()
	if err != nil {
		return DetailPage{}, err
	}

	if err := request.TimeRange.Validate(); err != nil {
		return DetailPage{}, err
	}
	summary, found, err := s.store.GetIssue(ctx, projectID, issueID, request.TimeRange)
	if err != nil {
		return DetailPage{}, fmt.Errorf("查询 Issue 详情: %w", err)
	}
	if !found {
		return DetailPage{}, ErrIssueNotFound
	}

	occurrences, err := s.store.ListOccurrences(ctx, OccurrenceFilter{
		TimeRange: request.TimeRange,
		ProjectID: projectID,
		IssueID:   issueID,
		Offset:    pagination.Offset(),
		Limit:     pagination.PageSize,
	})
	if err != nil {
		return DetailPage{}, fmt.Errorf("查询 Issue 发生记录: %w", err)
	}

	return DetailPage{PageInfo: pagination.Info(summary.EventCount), Issue: summary, Occurrences: occurrences}, nil
}

func isValidIssueID(value string) bool {
	if len(value) != fingerprintLength || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
