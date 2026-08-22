// issuequery 包负责把错误事件按稳定指纹聚合为 Issue，并处理列表游标和项目授权。
package issuequery

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
)

const (
	DefaultLimit         = 30
	MaxLimit             = 100
	maxFingerprintLength = 64
)

var (
	ErrProjectIDRequired = errors.New("project ID is required")
	ErrInvalidLimit      = errors.New("invalid issue list limit")
	ErrInvalidCursor     = errors.New("invalid issue list cursor")
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

// CursorKey 是按最近发生时间倒序分页时的最后一条 Issue 位置。
type CursorKey struct {
	LastSeen time.Time
	IssueID  string
}

type ListFilter struct {
	ProjectID string
	Before    *CursorKey
	Limit     int
}

type Store interface {
	ListIssues(ctx context.Context, filter ListFilter) ([]Summary, error)
}

type ProjectAuthorizer interface {
	CanAccess(ctx context.Context, userID, projectID string) (bool, error)
}

type ListRequest struct {
	UserID    string
	ProjectID string
	Limit     int
	Cursor    string
}

type ListPage struct {
	Issues     []Summary
	NextCursor string
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

	issues, err := s.store.ListIssues(ctx, ListFilter{
		ProjectID: projectID,
		Before:    before,
		Limit:     limit + 1,
	})
	if err != nil {
		return ListPage{}, fmt.Errorf("查询 Issue 列表: %w", err)
	}

	page := ListPage{Issues: issues}
	if len(issues) <= limit {
		return page, nil
	}

	page.Issues = issues[:limit]
	lastIssue := page.Issues[len(page.Issues)-1]
	page.NextCursor = encodeCursor(CursorKey{
		LastSeen: lastIssue.LastSeen,
		IssueID:  lastIssue.ID,
	})

	return page, nil
}

type cursorPayload struct {
	LastSeen *int64 `json:"lastSeen"`
	IssueID  string `json:"issueId"`
}

func encodeCursor(key CursorKey) string {
	lastSeen := key.LastSeen.UnixMilli()
	payload, err := json.Marshal(cursorPayload{LastSeen: &lastSeen, IssueID: key.IssueID})
	if err != nil {
		panic(fmt.Sprintf("编码 Issue 游标: %v", err))
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
	if payload.LastSeen == nil || *payload.LastSeen < 0 {
		return CursorKey{}, errors.New("lastSeen 无效")
	}
	if strings.TrimSpace(payload.IssueID) == "" || utf8.RuneCountInString(payload.IssueID) > maxFingerprintLength {
		return CursorKey{}, errors.New("issueId 无效")
	}

	return CursorKey{
		LastSeen: time.UnixMilli(*payload.LastSeen).UTC(),
		IssueID:  payload.IssueID,
	}, nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("游标必须只包含一个 JSON 值")
	}
	return nil
}
