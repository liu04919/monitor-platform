package clickhouse

import (
	"context"
	"fmt"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/eventquery"
)

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
		JSONExtractString(payload_json, 'message') AS message,
		received_at
	FROM telemetry_events
	WHERE project_id = ?
`

// EventReader 从 ClickHouse 读取事件列表；公开路由和鉴权由后续管理端链路负责。
type EventReader struct {
	conn driver.Conn
}

var _ eventquery.Store = (*EventReader)(nil)

func NewEventReader(conn driver.Conn) *EventReader {
	return &EventReader{conn: conn}
}

func (r *EventReader) List(
	ctx context.Context,
	filter eventquery.ListFilter,
) ([]eventquery.EventSummary, error) {
	query := strings.Builder{}
	query.WriteString(listTelemetryEventsSQL)
	arguments := []any{filter.ProjectID}

	if filter.Category != "" {
		query.WriteString("\tAND category = ?\n")
		arguments = append(arguments, string(filter.Category))
	}
	if filter.EventType != "" {
		query.WriteString("\tAND event_type = ?\n")
		arguments = append(arguments, filter.EventType)
	}
	if filter.Before != nil {
		// 显式按 Unix 毫秒恢复 DateTime64(3)，避免驱动参数推断丢失毫秒精度。
		query.WriteString("\tAND (event_timestamp, event_id) < (fromUnixTimestamp64Milli(?), ?)\n")
		arguments = append(arguments, filter.Before.Timestamp.UnixMilli(), filter.Before.EventID)
	}

	query.WriteString("\tORDER BY event_timestamp DESC, event_id DESC\n\tLIMIT ?")
	arguments = append(arguments, filter.Limit)

	rows, err := r.conn.Query(ctx, query.String(), arguments...)
	if err != nil {
		return nil, fmt.Errorf("执行 ClickHouse 事件列表查询: %w", err)
	}
	defer rows.Close()

	events := make([]eventquery.EventSummary, 0, filter.Limit)
	for rows.Next() {
		var (
			event    eventquery.EventSummary
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
			return nil, fmt.Errorf("扫描 ClickHouse 事件列表: %w", err)
		}

		event.SendType = dto.SendType(sendType)
		event.Category = dto.EventCategory(category)
		if level != nil {
			eventLevel := dto.EventLevel(*level)
			event.Level = &eventLevel
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历 ClickHouse 事件列表: %w", err)
	}

	return events, nil
}
