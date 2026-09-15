package clickhouse

import (
	"context"
	"fmt"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/liu04919/monitor-platform/apps/server/internal/issue"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

const listIssuesSQL = `
	SELECT
		issue_fingerprint,
		argMax(if(message = '', event_type, message), sort_key) AS title,
		argMax(event_type, sort_key) AS latest_event_type,
		argMax(exception_type, sort_key) AS latest_exception_type,
		count() AS event_count,
		uniqExactIf(user_id, isNotNull(user_id)) AS affected_users,
		min(event_timestamp) AS first_seen,
		max(event_timestamp) AS last_seen,
		argMax(event_id, sort_key) AS latest_event_id,
		argMax(page_url, sort_key) AS latest_page_url
	FROM
	(
		SELECT
			issue_fingerprint,
			event_type,
			event_timestamp,
			event_id,
			page_url,
			user_id,
			tuple(event_timestamp, event_id) AS sort_key,
			` + eventMessageExpression + ` AS message,
			JSONExtractString(payload_json, 'exception', 'name') AS exception_type
		FROM telemetry_events
		WHERE project_id = ?
			AND event_timestamp >= fromUnixTimestamp64Milli(?)
			AND event_timestamp < fromUnixTimestamp64Milli(?)
			AND category = 'error'
			AND issue_fingerprint != ''
	)
	GROUP BY issue_fingerprint
`

const listIssueOccurrencesSQL = `
	SELECT
		event_id,
		event_type,
		event_timestamp,
		page_url,
		user_id,
		` + eventMessageExpression + ` AS message,
		received_at
	FROM telemetry_events
	WHERE project_id = ?
		AND issue_fingerprint = ?
		AND event_timestamp >= fromUnixTimestamp64Milli(?)
		AND event_timestamp < fromUnixTimestamp64Milli(?)
`

// IssueReader 从 ClickHouse 的错误事件中读取按稳定指纹聚合的 Issue。
type IssueReader struct {
	conn driver.Conn
}

var _ issue.Store = (*IssueReader)(nil)

func NewIssueReader(conn driver.Conn) *IssueReader {
	return &IssueReader{conn: conn}
}

func (r *IssueReader) ListIssues(
	ctx context.Context,
	filter issue.ListFilter,
) ([]issue.Summary, error) {
	query := strings.Builder{}
	query.WriteString(listIssuesSQL)
	arguments := []any{filter.ProjectID, filter.TimeRange.From, filter.TimeRange.To}

	if filter.Before != nil {
		query.WriteString("\tHAVING (last_seen, issue_fingerprint) < (fromUnixTimestamp64Milli(?), ?)\n")
		arguments = append(arguments, filter.Before.LastSeen.UnixMilli(), filter.Before.IssueID)
	}

	query.WriteString("\tORDER BY last_seen DESC, issue_fingerprint DESC\n\tLIMIT ?")
	arguments = append(arguments, filter.Limit)

	rows, err := r.conn.Query(ctx, query.String(), arguments...)
	if err != nil {
		return nil, fmt.Errorf("执行 ClickHouse Issue 列表查询: %w", err)
	}
	defer rows.Close()

	issues := make([]issue.Summary, 0, filter.Limit)
	for rows.Next() {
		var issue issue.Summary
		if err := rows.Scan(
			&issue.ID,
			&issue.Title,
			&issue.EventType,
			&issue.ExceptionType,
			&issue.EventCount,
			&issue.AffectedUsers,
			&issue.FirstSeen,
			&issue.LastSeen,
			&issue.LatestEventID,
			&issue.LatestPageURL,
		); err != nil {
			return nil, fmt.Errorf("扫描 ClickHouse Issue 列表: %w", err)
		}
		issues = append(issues, issue)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历 ClickHouse Issue 列表: %w", err)
	}

	return issues, nil
}

func (r *IssueReader) GetIssue(
	ctx context.Context,
	projectID string,
	issueID string,
	timeRange telemetry.TimeRange,
) (issue.Summary, bool, error) {
	query := listIssuesSQL + "\tHAVING issue_fingerprint = ?\n\tLIMIT 1"
	rows, err := r.conn.Query(ctx, query, projectID, timeRange.From, timeRange.To, issueID)
	if err != nil {
		return issue.Summary{}, false, fmt.Errorf("执行 ClickHouse Issue 详情查询: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return issue.Summary{}, false, fmt.Errorf("遍历 ClickHouse Issue 详情: %w", err)
		}
		return issue.Summary{}, false, nil
	}

	var summary issue.Summary
	if err := rows.Scan(
		&summary.ID,
		&summary.Title,
		&summary.EventType,
		&summary.ExceptionType,
		&summary.EventCount,
		&summary.AffectedUsers,
		&summary.FirstSeen,
		&summary.LastSeen,
		&summary.LatestEventID,
		&summary.LatestPageURL,
	); err != nil {
		return issue.Summary{}, false, fmt.Errorf("扫描 ClickHouse Issue 详情: %w", err)
	}

	return summary, true, nil
}

func (r *IssueReader) ListOccurrences(
	ctx context.Context,
	filter issue.OccurrenceFilter,
) ([]issue.Occurrence, error) {
	query := strings.Builder{}
	query.WriteString(listIssueOccurrencesSQL)
	arguments := []any{filter.ProjectID, filter.IssueID, filter.TimeRange.From, filter.TimeRange.To}

	if filter.Before != nil {
		query.WriteString("\tAND (event_timestamp, event_id) < (fromUnixTimestamp64Milli(?), ?)\n")
		arguments = append(arguments, filter.Before.Timestamp.UnixMilli(), filter.Before.EventID)
	}

	query.WriteString("\tORDER BY event_timestamp DESC, event_id DESC\n\tLIMIT ?")
	arguments = append(arguments, filter.Limit)

	rows, err := r.conn.Query(ctx, query.String(), arguments...)
	if err != nil {
		return nil, fmt.Errorf("执行 ClickHouse Issue 发生记录查询: %w", err)
	}
	defer rows.Close()

	occurrences := make([]issue.Occurrence, 0, filter.Limit)
	for rows.Next() {
		var occurrence issue.Occurrence
		if err := rows.Scan(
			&occurrence.EventID,
			&occurrence.EventType,
			&occurrence.Timestamp,
			&occurrence.PageURL,
			&occurrence.UserID,
			&occurrence.Message,
			&occurrence.ReceivedAt,
		); err != nil {
			return nil, fmt.Errorf("扫描 ClickHouse Issue 发生记录: %w", err)
		}
		occurrences = append(occurrences, occurrence)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历 ClickHouse Issue 发生记录: %w", err)
	}

	return occurrences, nil
}
