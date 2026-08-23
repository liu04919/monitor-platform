// issue 包负责稳定错误指纹、Issue 聚合、项目授权和游标分页规则。
package issue

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
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
	fingerprintLength    = 32
	maxEventIDLength     = 128
)

var (
	ErrProjectIDRequired = errors.New("project ID is required")
	ErrInvalidLimit      = errors.New("invalid issue list limit")
	ErrInvalidCursor     = errors.New("invalid issue list cursor")
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

// CursorKey 是按最近发生时间倒序分页时的最后一条 Issue 位置。
type CursorKey struct {
	LastSeen time.Time
	IssueID  string
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

// OccurrenceCursorKey 是发生记录按事件时间倒序分页时的最后一条位置。
type OccurrenceCursorKey struct {
	Timestamp time.Time
	EventID   string
}

type ListFilter struct {
	ProjectID string
	Before    *CursorKey
	Limit     int
}

type OccurrenceFilter struct {
	ProjectID string
	IssueID   string
	Before    *OccurrenceCursorKey
	Limit     int
}

type Store interface {
	ListIssues(ctx context.Context, filter ListFilter) ([]Summary, error)
	GetIssue(ctx context.Context, projectID, issueID string) (Summary, bool, error)
	ListOccurrences(ctx context.Context, filter OccurrenceFilter) ([]Occurrence, error)
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

type DetailRequest struct {
	UserID    string
	ProjectID string
	IssueID   string
	Limit     int
	Cursor    string
}

type DetailPage struct {
	Issue       Summary
	Occurrences []Occurrence
	NextCursor  string
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

	limit := request.Limit
	if limit == 0 {
		limit = DefaultLimit
	}
	if limit < 1 || limit > MaxLimit {
		return DetailPage{}, ErrInvalidLimit
	}

	var before *OccurrenceCursorKey
	if request.Cursor != "" {
		decoded, err := decodeOccurrenceCursor(request.Cursor)
		if err != nil {
			return DetailPage{}, fmt.Errorf("%w: %v", ErrInvalidCursor, err)
		}
		before = &decoded
	}

	summary, found, err := s.store.GetIssue(ctx, projectID, issueID)
	if err != nil {
		return DetailPage{}, fmt.Errorf("查询 Issue 详情: %w", err)
	}
	if !found {
		return DetailPage{}, ErrIssueNotFound
	}

	occurrences, err := s.store.ListOccurrences(ctx, OccurrenceFilter{
		ProjectID: projectID,
		IssueID:   issueID,
		Before:    before,
		Limit:     limit + 1,
	})
	if err != nil {
		return DetailPage{}, fmt.Errorf("查询 Issue 发生记录: %w", err)
	}

	page := DetailPage{Issue: summary, Occurrences: occurrences}
	if len(occurrences) <= limit {
		return page, nil
	}

	page.Occurrences = occurrences[:limit]
	lastOccurrence := page.Occurrences[len(page.Occurrences)-1]
	page.NextCursor = encodeOccurrenceCursor(OccurrenceCursorKey{
		Timestamp: lastOccurrence.Timestamp,
		EventID:   lastOccurrence.EventID,
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

type occurrenceCursorPayload struct {
	Timestamp *int64 `json:"timestamp"`
	EventID   string `json:"eventId"`
}

func encodeOccurrenceCursor(key OccurrenceCursorKey) string {
	timestamp := key.Timestamp.UnixMilli()
	payload, err := json.Marshal(occurrenceCursorPayload{
		Timestamp: &timestamp,
		EventID:   key.EventID,
	})
	if err != nil {
		panic(fmt.Sprintf("编码 Issue 发生记录游标: %v", err))
	}

	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeOccurrenceCursor(value string) (OccurrenceCursorKey, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return OccurrenceCursorKey{}, fmt.Errorf("Base64 解码失败: %w", err)
	}

	decoder := json.NewDecoder(bytes.NewReader(decoded))
	decoder.DisallowUnknownFields()

	var payload occurrenceCursorPayload
	if err := decoder.Decode(&payload); err != nil {
		return OccurrenceCursorKey{}, fmt.Errorf("JSON 解码失败: %w", err)
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return OccurrenceCursorKey{}, err
	}
	if payload.Timestamp == nil || *payload.Timestamp < 0 {
		return OccurrenceCursorKey{}, errors.New("timestamp 无效")
	}
	if strings.TrimSpace(payload.EventID) == "" || utf8.RuneCountInString(payload.EventID) > maxEventIDLength {
		return OccurrenceCursorKey{}, errors.New("eventId 无效")
	}

	return OccurrenceCursorKey{
		Timestamp: time.UnixMilli(*payload.Timestamp).UTC(),
		EventID:   payload.EventID,
	}, nil
}

func isValidIssueID(value string) bool {
	if len(value) != fingerprintLength || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("游标必须只包含一个 JSON 值")
	}
	return nil
}
