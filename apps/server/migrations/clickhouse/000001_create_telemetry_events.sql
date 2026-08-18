CREATE TABLE IF NOT EXISTS monitor_platform.telemetry_events
(
    schema_version UInt16,
    project_id String,
    app_name String,
    batch_id String,
    send_type LowCardinality(String),
    sent_at DateTime64(3, 'UTC'),
    event_id String,
    category LowCardinality(String),
    event_type LowCardinality(String),
    event_timestamp DateTime64(3, 'UTC'),
    page_url String,
    user_id Nullable(String),
    level Nullable(String),
    breadcrumbs_json String,
    replay_data Nullable(String),
    payload_json String,
    received_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_timestamp)
ORDER BY (project_id, category, event_timestamp, event_id);
