//go:build integration

package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"gorm.io/gorm"

	"github.com/liu04919/monitor-platform/apps/server/internal/app"
	"github.com/liu04919/monitor-platform/apps/server/internal/config"
	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/migration"
	postgresstore "github.com/liu04919/monitor-platform/apps/server/internal/storage/postgres"
)

func TestApplicationTelemetryHTTPWithPostgreSQLAndClickHouse(t *testing.T) {
	postgresDSN := os.Getenv("TEST_DATABASE_URL")
	clickHouseDSN := os.Getenv("TEST_CLICKHOUSE_DSN")
	if postgresDSN == "" || clickHouseDSN == "" {
		t.Skip("未设置 TEST_DATABASE_URL 或 TEST_CLICKHOUSE_DSN，跳过完整 HTTP 集成测试")
	}

	ctx := context.Background()
	postgresDB, err := database.OpenPostgreSQL(
		ctx,
		database.PostgreSQLConfig{DSN: postgresDSN},
	)
	if err != nil {
		t.Fatalf("连接 PostgreSQL 失败: %v", err)
	}
	postgresPool, err := postgresDB.DB()
	if err != nil {
		t.Fatalf("获取 PostgreSQL 连接池失败: %v", err)
	}
	t.Cleanup(func() {
		_ = postgresPool.Close()
	})

	clickHouseConn, err := database.OpenClickHouse(
		ctx,
		database.ClickHouseConfig{DSN: clickHouseDSN},
	)
	if err != nil {
		t.Fatalf("连接 ClickHouse 失败: %v", err)
	}
	t.Cleanup(func() {
		_ = clickHouseConn.Close()
	})

	if err := migration.Up(ctx, postgresDB, clickHouseConn); err != nil {
		t.Fatalf("应用测试数据库迁移失败: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	suffix := fmt.Sprintf("%d", now.UnixNano())
	projectID := "app-http-project-" + suffix
	publicKey := "app-http-key-" + suffix
	project := postgresstore.Project{
		ID:        projectID,
		Name:      "应用 HTTP 集成测试",
		PublicKey: publicKey,
		Enabled:   true,
	}
	if err := postgresDB.WithContext(ctx).Create(&project).Error; err != nil {
		t.Fatalf("创建测试项目失败: %v", err)
	}
	t.Cleanup(func() {
		cleanupApplicationData(t, postgresDB, clickHouseConn, projectID)
	})

	application, err := app.New(ctx, config.Config{
		DatabaseURL:   postgresDSN,
		ClickHouseDSN: clickHouseDSN,
	})
	if err != nil {
		t.Fatalf("创建应用失败: %v", err)
	}
	t.Cleanup(func() {
		if err := application.Close(); err != nil {
			t.Errorf("关闭应用失败: %v", err)
		}
	})

	server := httptest.NewServer(application.Handler)
	t.Cleanup(server.Close)

	assertTelemetryPreflight(t, server.URL)

	batch := applicationBatch(projectID, publicKey, "normal-"+suffix, now)
	status, response := postTelemetryBatch(t, server.URL, batch)
	if status != http.StatusAccepted {
		t.Fatalf("正常上报状态码 = %d, want %d, error = %q", status, http.StatusAccepted, response.Error.Code)
	}
	if response.Data.BatchID != batch.BatchID {
		t.Fatalf("返回 batchId = %q, want %q", response.Data.BatchID, batch.BatchID)
	}
	if response.Data.Accepted != len(batch.Events) || response.Data.Duplicate {
		t.Fatalf("正常上报结果异常: %#v", response.Data)
	}

	status, response = postTelemetryBatch(t, server.URL, batch)
	if status != http.StatusAccepted {
		t.Fatalf("重复上报状态码 = %d, want %d", status, http.StatusAccepted)
	}
	if response.Data.Accepted != 0 || !response.Data.Duplicate {
		t.Fatalf("重复上报结果异常: %#v", response.Data)
	}

	invalidKeyBatch := applicationBatch(projectID, "wrong-public-key", "invalid-key-"+suffix, now)
	status, response = postTelemetryBatch(t, server.URL, invalidKeyBatch)
	if status != http.StatusForbidden || response.Error.Code != "INVALID_PUBLIC_KEY" {
		t.Fatalf("错误 publicKey 结果 = status %d, code %q", status, response.Error.Code)
	}

	conflictBatch := batch
	conflictBatch.Events = append([]dto.TelemetryEvent(nil), batch.Events...)
	conflictBatch.Events[0].Payload = json.RawMessage(`{"data":{"action":"different"}}`)
	status, response = postTelemetryBatch(t, server.URL, conflictBatch)
	if status != http.StatusConflict || response.Error.Code != "BATCH_ID_CONFLICT" {
		t.Fatalf("batchId 内容冲突结果 = status %d, code %q", status, response.Error.Code)
	}

	assertApplicationReceiptCompleted(t, ctx, postgresDB, projectID, batch.BatchID)
	assertApplicationEventCount(
		t,
		ctx,
		clickHouseConn,
		projectID,
		batch.BatchID,
		uint64(len(batch.Events)),
	)
}

func assertTelemetryPreflight(t *testing.T, serverURL string) {
	t.Helper()

	request, err := http.NewRequest(
		http.MethodOptions,
		serverURL+"/api/v1/events/batch",
		nil,
	)
	if err != nil {
		t.Fatalf("创建预检请求失败: %v", err)
	}
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "content-type")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("发送预检请求失败: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("预检状态码 = %d, want %d", response.StatusCode, http.StatusNoContent)
	}
	if origin := response.Header.Get("Access-Control-Allow-Origin"); origin != "*" {
		t.Fatalf("预检允许来源 = %q, want %q", origin, "*")
	}
}

func postTelemetryBatch(
	t *testing.T,
	serverURL string,
	batch dto.TelemetryBatch,
) (int, applicationHTTPResponse) {
	t.Helper()

	body, err := json.Marshal(batch)
	if err != nil {
		t.Fatalf("编码上报批次失败: %v", err)
	}
	request, err := http.NewRequest(
		http.MethodPost,
		serverURL+"/api/v1/events/batch",
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatalf("创建上报请求失败: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:5173")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("发送上报请求失败: %v", err)
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("读取上报响应失败: %v", err)
	}
	if origin := response.Header.Get("Access-Control-Allow-Origin"); origin != "*" {
		t.Fatalf("上报响应允许来源 = %q, want %q", origin, "*")
	}

	var decoded applicationHTTPResponse
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		t.Fatalf("解码上报响应失败: %v, body = %s", err, responseBody)
	}

	return response.StatusCode, decoded
}

type applicationHTTPResponse struct {
	Data struct {
		BatchID   string `json:"batchId"`
		Accepted  int    `json:"accepted"`
		Duplicate bool   `json:"duplicate"`
	} `json:"data"`
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
}

func applicationBatch(
	projectID string,
	publicKey string,
	batchID string,
	timestamp time.Time,
) dto.TelemetryBatch {
	return dto.TelemetryBatch{
		SchemaVersion: 2,
		BatchID:       batchID,
		SentAt:        timestamp.UnixMilli(),
		PublicKey:     publicKey,
		App: dto.App{
			ID:   projectID,
			Name: "应用 HTTP 集成测试",
		},
		Events: []dto.TelemetryEvent{
			{
				SchemaVersion: 2,
				EventID:       batchID + "-event-1",
				Category:      dto.EventCategoryBehavior,
				EventType:     "custom",
				Timestamp:     timestamp.UnixMilli(),
				PageURL:       "http://localhost:5173/test",
				Payload:       json.RawMessage(`{"data":{"action":"integration"}}`),
			},
			{
				SchemaVersion: 2,
				EventID:       batchID + "-event-2",
				Category:      dto.EventCategoryPerformance,
				EventType:     "web_vital",
				Timestamp:     timestamp.Add(time.Millisecond).UnixMilli(),
				PageURL:       "http://localhost:5173/test",
				Payload: json.RawMessage(
					`{"name":"fcp","value":120,"unit":"ms","attributes":{}}`,
				),
			},
		},
		SendType: dto.SendTypeFetch,
	}
}

func assertApplicationReceiptCompleted(
	t *testing.T,
	ctx context.Context,
	db *gorm.DB,
	projectID string,
	batchID string,
) {
	t.Helper()

	var receipt postgresstore.IngestionBatch
	if err := db.WithContext(ctx).
		Where("project_id = ? AND batch_id = ?", projectID, batchID).
		Take(&receipt).
		Error; err != nil {
		t.Fatalf("查询批次记录失败: %v", err)
	}
	if receipt.Status != "completed" {
		t.Fatalf("批次状态 = %q, want %q", receipt.Status, "completed")
	}
}

func assertApplicationEventCount(
	t *testing.T,
	ctx context.Context,
	conn driver.Conn,
	projectID string,
	batchID string,
	want uint64,
) {
	t.Helper()

	var count uint64
	if err := conn.QueryRow(
		ctx,
		"SELECT count() FROM telemetry_events WHERE project_id = ? AND batch_id = ?",
		projectID,
		batchID,
	).Scan(&count); err != nil {
		t.Fatalf("查询 ClickHouse 事件数量失败: %v", err)
	}
	if count != want {
		t.Fatalf("ClickHouse 事件数量 = %d, want %d", count, want)
	}
}

func cleanupApplicationData(
	t *testing.T,
	postgresDB *gorm.DB,
	clickHouseConn driver.Conn,
	projectID string,
) {
	t.Helper()

	cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := clickHouseConn.Exec(
		cleanupCtx,
		"ALTER TABLE telemetry_events DELETE WHERE project_id = ? SETTINGS mutations_sync = 1",
		projectID,
	); err != nil {
		t.Errorf("清理 ClickHouse 测试事件失败: %v", err)
	}
	if err := postgresDB.WithContext(cleanupCtx).
		Where("project_id = ?", projectID).
		Delete(&postgresstore.IngestionBatch{}).
		Error; err != nil {
		t.Errorf("清理 PostgreSQL 测试批次失败: %v", err)
	}
	if err := postgresDB.WithContext(cleanupCtx).
		Where("id = ?", projectID).
		Delete(&postgresstore.Project{}).
		Error; err != nil {
		t.Errorf("清理 PostgreSQL 测试项目失败: %v", err)
	}
}
