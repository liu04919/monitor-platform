// eventquery 包负责事件列表的查询规则和游标分页，不包含 HTTP 鉴权或路由。
package eventquery

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

const (
	DefaultLimit = 50
	MaxLimit     = 100
	maxIDLength  = 128
)

var (
	ErrProjectIDRequired = errors.New("project ID is required")
	ErrInvalidCategory   = errors.New("invalid event category")
	ErrInvalidLimit      = errors.New("invalid event list limit")
	ErrInvalidCursor     = errors.New("invalid event list cursor")
)

// EventSummary 是事件列表需要的轻量字段；完整 payload 留给后续详情查询。
type EventSummary struct {
	BatchID    string
	SendType   dto.SendType
	EventID    string
	Category   dto.EventCategory
	EventType  string
	Timestamp  time.Time
	PageURL    string
	UserID     *string
	Level      *dto.EventLevel
	Message    string
	ReceivedAt time.Time
}

// CursorKey 是 ClickHouse 键集分页的最后一条记录位置。
type CursorKey struct {
	Timestamp time.Time
	EventID   string
}

// ListFilter 是查询存储层使用的已校验条件。
type ListFilter struct {
	ProjectID string
	Category  dto.EventCategory
	EventType string
	Before    *CursorKey
	Limit     int
}

// Store 从事件存储中按稳定顺序读取列表。
type Store interface {
	List(ctx context.Context, filter ListFilter) ([]EventSummary, error)
	Get(ctx context.Context, projectID, eventID string) (EventDetail, bool, error)
}

type ListRequest struct {
	ProjectID string
	Category  dto.EventCategory
	EventType string
	Limit     int
	Cursor    string
}

type ListPage struct {
	Events     []EventSummary
	NextCursor string
}

type Service struct {
	store Store
}

func NewService(store Store) *Service {
	return &Service{store: store}
}

func (s *Service) List(ctx context.Context, request ListRequest) (ListPage, error) {
	projectID := strings.TrimSpace(request.ProjectID)
	if projectID == "" {
		return ListPage{}, ErrProjectIDRequired
	}
	if request.Category != "" && !isSupportedCategory(request.Category) {
		return ListPage{}, ErrInvalidCategory
	}

	limit := request.Limit
	if limit == 0 {
		limit = DefaultLimit
	}
	if limit < 1 || limit > MaxLimit {
		return ListPage{}, ErrInvalidLimit
	}

	var before *CursorKey
	if request.Cursor != "" {
		decoded, err := decodeCursor(request.Cursor)
		if err != nil {
			return ListPage{}, fmt.Errorf("%w: %v", ErrInvalidCursor, err)
		}
		before = &decoded
	}

	events, err := s.store.List(ctx, ListFilter{
		ProjectID: projectID,
		Category:  request.Category,
		EventType: strings.TrimSpace(request.EventType),
		Before:    before,
		// 多取一条，只用来判断是否还有下一页。
		Limit: limit + 1,
	})
	if err != nil {
		return ListPage{}, fmt.Errorf("查询事件列表: %w", err)
	}

	page := ListPage{Events: events}
	if len(events) <= limit {
		return page, nil
	}

	page.Events = events[:limit]
	lastEvent := page.Events[len(page.Events)-1]
	page.NextCursor = encodeCursor(CursorKey{
		Timestamp: lastEvent.Timestamp,
		EventID:   lastEvent.EventID,
	})

	return page, nil
}

type cursorPayload struct {
	Timestamp *int64 `json:"timestamp"`
	EventID   string `json:"eventId"`
}

func encodeCursor(key CursorKey) string {
	timestamp := key.Timestamp.UnixMilli()
	payload, err := json.Marshal(cursorPayload{
		Timestamp: &timestamp,
		EventID:   key.EventID,
	})
	if err != nil {
		panic(fmt.Sprintf("编码事件游标: %v", err))
	}

	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeCursor(value string) (CursorKey, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return CursorKey{}, fmt.Errorf("Base64 解码失败: %w", err)
	}

	decoder := json.NewDecoder(bytes.NewReader(decoded))
	decoder.DisallowUnknownFields()

	var payload cursorPayload
	if err := decoder.Decode(&payload); err != nil {
		return CursorKey{}, fmt.Errorf("JSON 解码失败: %w", err)
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return CursorKey{}, err
	}
	if payload.Timestamp == nil || *payload.Timestamp < 0 {
		return CursorKey{}, errors.New("timestamp 无效")
	}
	if strings.TrimSpace(payload.EventID) == "" || utf8.RuneCountInString(payload.EventID) > maxIDLength {
		return CursorKey{}, errors.New("eventId 无效")
	}

	return CursorKey{
		Timestamp: time.UnixMilli(*payload.Timestamp).UTC(),
		EventID:   payload.EventID,
	}, nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("游标必须只包含一个 JSON 值")
	}
	return nil
}

func isSupportedCategory(category dto.EventCategory) bool {
	switch category {
	case dto.EventCategoryError,
		dto.EventCategoryPerformance,
		dto.EventCategoryBehavior,
		dto.EventCategoryStability,
		dto.EventCategoryAI:
		return true
	default:
		return false
	}
}
