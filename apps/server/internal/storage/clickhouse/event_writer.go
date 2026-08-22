// clickhouse 包负责把已校验的遥测事件批量写入 ClickHouse。
package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	clickhouseclient "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
)

const insertTelemetryEventsSQL = `
	INSERT INTO telemetry_events
	(
		schema_version, project_id, app_name, batch_id, send_type, sent_at,
		event_id, category, event_type, event_timestamp, page_url,
		user_id, level, breadcrumbs_json, replay_data, payload_json, issue_fingerprint
	)
`

// EventWriter 使用官方原生客户端把一个 SDK 批次作为一个 ClickHouse 插入块写入。
type EventWriter struct {
	conn driver.Conn
}

var _ ingestion.EventWriter = (*EventWriter)(nil)

func NewEventWriter(conn driver.Conn) *EventWriter {
	return &EventWriter{conn: conn}
}

func (w *EventWriter) Write(
	ctx context.Context,
	batch dto.TelemetryBatch,
	deduplicationToken string,
) error {
	insertContext := clickhouseclient.Context(
		ctx,
		clickhouseclient.WithSettings(clickhouseclient.Settings{
			"insert_deduplication_token": deduplicationToken,
		}),
	)

	preparedBatch, err := w.conn.PrepareBatch(insertContext, insertTelemetryEventsSQL)
	if err != nil {
		return fmt.Errorf("准备 ClickHouse 批次: %w", err)
	}
	defer preparedBatch.Close()

	for index, event := range batch.Events {
		breadcrumbsJSON, err := json.Marshal(event.Breadcrumbs)
		if err != nil {
			return fmt.Errorf("编码事件 %d breadcrumbs: %w", index, err)
		}

		if err := preparedBatch.Append(
			uint16(event.SchemaVersion),
			batch.App.ID,
			batch.App.Name,
			batch.BatchID,
			string(batch.SendType),
			time.UnixMilli(batch.SentAt).UTC(),
			event.EventID,
			string(event.Category),
			event.EventType,
			time.UnixMilli(event.Timestamp).UTC(),
			event.PageURL,
			nullableString(event.UserID),
			nullableEventLevel(event.Level),
			string(breadcrumbsJSON),
			nullableString(event.ReplayData),
			string(event.Payload),
			event.IssueFingerprint,
		); err != nil {
			return fmt.Errorf("追加事件 %d: %w", index, err)
		}
	}

	if err := preparedBatch.Send(); err != nil {
		return fmt.Errorf("发送 ClickHouse 批次: %w", err)
	}

	return nil
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}

	return *value
}

func nullableEventLevel(value *dto.EventLevel) any {
	if value == nil {
		return nil
	}

	return string(*value)
}
