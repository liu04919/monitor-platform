package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/liu04919/monitor-platform/apps/server/internal/event"
	"github.com/liu04919/monitor-platform/apps/server/internal/telemetry"
)

const eventMessageExpression = `coalesce(
			nullIf(JSONExtractString(payload_json, 'message'), ''),
			nullIf(JSONExtractString(payload_json, 'exception', 'message'), ''),
			''
		)`

const telemetryEventsFromSQL = `
	FROM telemetry_events
	WHERE project_id = ?
		AND event_timestamp >= fromUnixTimestamp64Milli(?)
		AND event_timestamp < fromUnixTimestamp64Milli(?)
`

const listTelemetryEventsSQL = `
	SELECT
		batch_id,
		send_type,
		event_id,
		category,
		event_type,
		event_timestamp,
		page_url,
		user_id,
		level,
		` + eventMessageExpression + ` AS message,
		received_at
`

const getTelemetryEventSQL = `
	SELECT
		schema_version,
		project_id,
		app_name,
		batch_id,
		send_type,
		sent_at,
		event_id,
		category,
		event_type,
		event_timestamp,
		page_url,
		user_id,
		level,
		` + eventMessageExpression + ` AS message,
		breadcrumbs_json,
		replay_data,
		payload_json,
		received_at
	FROM telemetry_events
	WHERE project_id = ? AND event_id = ?
	LIMIT 1
`

// EventReader 从 ClickHouse 读取事件列表；公开路由和鉴权由后续管理端链路负责。
type EventReader struct {
	conn driver.Conn
}

var _ event.Store = (*EventReader)(nil)

func NewEventReader(conn driver.Conn) *EventReader {
	return &EventReader{conn: conn}
}

func (r *EventReader) List(
	ctx context.Context,
	filter event.ListFilter,
) ([]event.EventSummary, uint64, error) {
	query := strings.Builder{}
	query.WriteString(telemetryEventsFromSQL)
	arguments := []any{filter.ProjectID, filter.TimeRange.From, filter.TimeRange.To}

	if filter.Category != "" {
		query.WriteString("\tAND category = ?\n")
		arguments = append(arguments, string(filter.Category))
	}
	if filter.EventType != "" {
		query.WriteString("\tAND event_type = ?\n")
		arguments = append(arguments, filter.EventType)
	}

	var total uint64
	if err := r.conn.QueryRow(ctx, "SELECT count()"+query.String(), arguments...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("统计 ClickHouse 事件总数: %w", err)
	}
	if uint64(filter.Offset) >= total {
		return []event.EventSummary{}, total, nil
	}

	// 数据页与总数复用同一组筛选条件；时间相同时用事件 ID 保证顺序确定。
	pageSQL := listTelemetryEventsSQL + query.String() +
		"\tORDER BY event_timestamp DESC, event_id DESC\n\tLIMIT ? OFFSET ?"
	arguments = append(arguments, filter.Limit, filter.Offset)

	rows, err := r.conn.Query(ctx, pageSQL, arguments...)
	if err != nil {
		return nil, 0, fmt.Errorf("执行 ClickHouse 事件列表查询: %w", err)
	}
	defer rows.Close()

	events := make([]event.EventSummary, 0, filter.Limit)
	for rows.Next() {
		var (
			event    event.EventSummary
			sendType string
			category string
			level    *string
		)

		if err := rows.Scan(
			&event.BatchID,
			&sendType,
			&event.EventID,
			&category,
			&event.EventType,
			&event.Timestamp,
			&event.PageURL,
			&event.UserID,
			&level,
			&event.Message,
			&event.ReceivedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("扫描 ClickHouse 事件列表: %w", err)
		}

		event.SendType = telemetry.SendType(sendType)
		event.Category = telemetry.Category(category)
		if level != nil {
			eventLevel := telemetry.Level(*level)
			event.Level = &eventLevel
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("遍历 ClickHouse 事件列表: %w", err)
	}

	return events, total, nil
}

func (r *EventReader) Get(
	ctx context.Context,
	projectID string,
	eventID string,
) (event.EventDetail, bool, error) {
	rows, err := r.conn.Query(ctx, getTelemetryEventSQL, projectID, eventID)
	if err != nil {
		return event.EventDetail{}, false, fmt.Errorf("执行 ClickHouse 事件详情查询: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return event.EventDetail{}, false, fmt.Errorf("遍历 ClickHouse 事件详情: %w", err)
		}
		return event.EventDetail{}, false, nil
	}

	var (
		detail          event.EventDetail
		schemaVersion   uint16
		sendType        string
		category        string
		level           *string
		breadcrumbsJSON string
		payloadJSON     string
	)
	if err := rows.Scan(
		&schemaVersion,
		&detail.ProjectID,
		&detail.AppName,
		&detail.BatchID,
		&sendType,
		&detail.SentAt,
		&detail.EventID,
		&category,
		&detail.EventType,
		&detail.Timestamp,
		&detail.PageURL,
		&detail.UserID,
		&level,
		&detail.Message,
		&breadcrumbsJSON,
		&detail.ReplayData,
		&payloadJSON,
		&detail.ReceivedAt,
	); err != nil {
		return event.EventDetail{}, false, fmt.Errorf("扫描 ClickHouse 事件详情: %w", err)
	}

	breadcrumbs, err := storedJSONArray(breadcrumbsJSON)
	if err != nil {
		return event.EventDetail{}, false, fmt.Errorf("解析 ClickHouse breadcrumbs_json: %w", err)
	}
	payload, err := storedJSONObject(payloadJSON)
	if err != nil {
		return event.EventDetail{}, false, fmt.Errorf("解析 ClickHouse payload_json: %w", err)
	}

	detail.SchemaVersion = int(schemaVersion)
	detail.SendType = telemetry.SendType(sendType)
	detail.Category = telemetry.Category(category)
	detail.Breadcrumbs = breadcrumbs
	detail.Payload = payload
	if level != nil {
		eventLevel := telemetry.Level(*level)
		detail.Level = &eventLevel
	}

	return detail, true, nil
}

func storedJSONObject(value string) (json.RawMessage, error) {
	return storedJSON(value, '{', nil)
}

func storedJSONArray(value string) (json.RawMessage, error) {
	return storedJSON(value, '[', json.RawMessage("[]"))
}

func storedJSON(value string, prefix byte, nullValue json.RawMessage) (json.RawMessage, error) {
	trimmed := bytes.TrimSpace([]byte(value))
	if bytes.Equal(trimmed, []byte("null")) && nullValue != nil {
		return nullValue, nil
	}
	if len(trimmed) < 2 || trimmed[0] != prefix || !json.Valid(trimmed) {
		return nil, errors.New("stored value has an invalid JSON shape")
	}

	return json.RawMessage(trimmed), nil
}
