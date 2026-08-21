//go:build integration

package ingestion_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
	"github.com/liu04919/monitor-platform/apps/server/internal/migration"
	clickhousestore "github.com/liu04919/monitor-platform/apps/server/internal/storage/clickhouse"
	postgresstore "github.com/liu04919/monitor-platform/apps/server/internal/storage/postgres"
)

func TestBatchStoreWithPostgreSQLAndClickHouse(t *testing.T) {
	postgresDSN := os.Getenv("TEST_DATABASE_URL")
	clickHouseDSN := os.Getenv("TEST_CLICKHOUSE_DSN")
	if postgresDSN == "" || clickHouseDSN == "" {
		t.Skip("未设置 TEST_DATABASE_URL 或 TEST_CLICKHOUSE_DSN，跳过双数据库集成测试")
	}

	ctx := context.Background()
	postgresDB, err := database.OpenPostgreSQL(ctx, database.PostgreSQLConfig{DSN: postgresDSN})
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

	clickHouseConn, err := database.OpenClickHouse(ctx, database.ClickHouseConfig{DSN: clickHouseDSN})
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
	projectID := "batch-store-project-" + suffix
	owner := postgresstore.User{
		ID:           uuid.NewString(),
		Email:        "batch-store-" + suffix + "@example.com",
		PasswordHash: "integration-test-only",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := postgresDB.WithContext(ctx).Create(&owner).Error; err != nil {
		t.Fatalf("创建测试用户失败: %v", err)
	}
	project := postgresstore.Project{
		ID:          projectID,
		OwnerUserID: owner.ID,
		Name:        "BatchStore 集成测试",
		PublicKey:   "batch-store-key-" + suffix,
		Enabled:     true,
	}
	if err := postgresDB.WithContext(ctx).Create(&project).Error; err != nil {
		t.Fatalf("创建测试项目失败: %v", err)
	}

	t.Cleanup(func() {
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
		if err := postgresDB.WithContext(cleanupCtx).
			Where("id = ?", owner.ID).
			Delete(&postgresstore.User{}).
			Error; err != nil {
			t.Errorf("清理 PostgreSQL 测试用户失败: %v", err)
		}
	})

	receipts := postgresstore.NewBatchReceiptStore(postgresDB)
	eventWriter := clickhousestore.NewEventWriter(clickHouseConn)
	store := ingestion.NewBatchStore(receipts, eventWriter)

	t.Run("新批次、完成后重复和内容冲突", func(t *testing.T) {
		batch := integrationBatch(projectID, "normal-"+suffix, now)

		result, err := store.Save(ctx, batch)
		if err != nil {
			t.Fatalf("保存新批次失败: %v", err)
		}
		if result.Duplicate {
			t.Fatal("新批次被错误识别为重复")
		}

		assertReceiptStatus(t, ctx, postgresDB, projectID, batch.BatchID, "completed")
		assertClickHouseEventCount(t, ctx, clickHouseConn, projectID, batch.BatchID, uint64(len(batch.Events)))

		result, err = store.Save(ctx, batch)
		if err != nil {
			t.Fatalf("保存重复批次失败: %v", err)
		}
		if !result.Duplicate {
			t.Fatal("完成批次没有被识别为重复")
		}
		assertClickHouseEventCount(t, ctx, clickHouseConn, projectID, batch.BatchID, uint64(len(batch.Events)))

		conflict := batch
		conflict.Events = append([]dto.TelemetryEvent(nil), batch.Events...)
		conflict.Events[0].Payload = json.RawMessage(`{"message":"different content"}`)
		_, err = store.Save(ctx, conflict)
		if !errors.Is(err, ingestion.ErrBatchIDConflict) {
			t.Fatalf("冲突批次错误 = %v, want %v", err, ingestion.ErrBatchIDConflict)
		}
	})

	t.Run("ClickHouse 成功但完成标记失败后重试", func(t *testing.T) {
		batch := integrationBatch(projectID, "recovery-"+suffix, now.Add(time.Second))
		afterWriteError := errors.New("模拟 ClickHouse 成功后的链路错误")
		failingStore := ingestion.NewBatchStore(
			receipts,
			&errorAfterWriteEventWriter{
				writer: eventWriter,
				err:    afterWriteError,
			},
		)

		_, err := failingStore.Save(ctx, batch)
		if !errors.Is(err, afterWriteError) {
			t.Fatalf("第一次保存错误 = %v, want %v", err, afterWriteError)
		}
		assertReceiptStatus(t, ctx, postgresDB, projectID, batch.BatchID, "pending")
		assertClickHouseEventCount(t, ctx, clickHouseConn, projectID, batch.BatchID, uint64(len(batch.Events)))

		result, err := store.Save(ctx, batch)
		if err != nil {
			t.Fatalf("恢复保存失败: %v", err)
		}
		if result.Duplicate {
			t.Fatal("pending 批次恢复不应返回已完成重复")
		}

		assertReceiptStatus(t, ctx, postgresDB, projectID, batch.BatchID, "completed")
		assertClickHouseEventCount(t, ctx, clickHouseConn, projectID, batch.BatchID, uint64(len(batch.Events)))
	})
}

type errorAfterWriteEventWriter struct {
	writer ingestion.EventWriter
	err    error
}

func (w *errorAfterWriteEventWriter) Write(
	ctx context.Context,
	batch dto.TelemetryBatch,
	deduplicationToken string,
) error {
	if err := w.writer.Write(ctx, batch, deduplicationToken); err != nil {
		return err
	}

	return w.err
}

func assertReceiptStatus(
	t *testing.T,
	ctx context.Context,
	db *gorm.DB,
	projectID string,
	batchID string,
	want string,
) {
	t.Helper()

	var receipt postgresstore.IngestionBatch
	if err := db.WithContext(ctx).
		Where("project_id = ? AND batch_id = ?", projectID, batchID).
		Take(&receipt).
		Error; err != nil {
		t.Fatalf("查询批次记录失败: %v", err)
	}
	if receipt.Status != want {
		t.Fatalf("批次状态 = %q, want %q", receipt.Status, want)
	}
}

func assertClickHouseEventCount(
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

func integrationBatch(projectID, batchID string, timestamp time.Time) dto.TelemetryBatch {
	userID := "integration-user"
	level := dto.EventLevelError

	return dto.TelemetryBatch{
		SchemaVersion: 2,
		BatchID:       batchID,
		SentAt:        timestamp.UnixMilli(),
		PublicKey:     "integration-public-key",
		App: dto.App{
			ID:   projectID,
			Name: "BatchStore 集成测试",
		},
		Events: []dto.TelemetryEvent{
			{
				SchemaVersion: 2,
				EventID:       batchID + "-event-1",
				Category:      dto.EventCategoryError,
				EventType:     "exception",
				Timestamp:     timestamp.UnixMilli(),
				PageURL:       "https://example.com/error",
				UserID:        &userID,
				Level:         &level,
				Breadcrumbs:   []dto.Breadcrumb{},
				Payload:       json.RawMessage(`{"message":"integration error"}`),
			},
			{
				SchemaVersion: 2,
				EventID:       batchID + "-event-2",
				Category:      dto.EventCategoryPerformance,
				EventType:     "metric",
				Timestamp:     timestamp.Add(time.Millisecond).UnixMilli(),
				PageURL:       "https://example.com/performance",
				Breadcrumbs:   []dto.Breadcrumb{},
				Payload:       json.RawMessage(`{"name":"fcp","value":120,"unit":"ms","attributes":{}}`),
			},
		},
		SendType: dto.SendTypeFetch,
	}
}
