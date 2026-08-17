//go:build integration

package postgres_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
	projectstore "github.com/liu04919/monitor-platform/apps/server/internal/storage/postgres"
)

func TestProjectKeyVerifierWithPostgreSQL(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("未设置 TEST_DATABASE_URL，跳过 PostgreSQL 集成测试")
	}

	ctx := context.Background()
	db, err := database.OpenPostgreSQL(ctx, database.PostgreSQLConfig{DSN: dsn})
	if err != nil {
		t.Fatalf("连接测试数据库失败: %v", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("获取数据库连接池失败: %v", err)
	}
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	tx := db.WithContext(ctx).Begin()
	if tx.Error != nil {
		t.Fatalf("开始事务失败: %v", tx.Error)
	}
	t.Cleanup(func() {
		tx.Rollback()
	})

	project := projectstore.Project{
		ID:        "integration-project",
		Name:      "集成测试项目",
		PublicKey: "integration-public-key",
		Enabled:   true,
	}
	if err := tx.Create(&project).Error; err != nil {
		t.Fatalf("创建测试项目失败: %v", err)
	}

	verifier := projectstore.NewProjectKeyVerifier(tx)
	if err := verifier.Verify(ctx, project.ID, project.PublicKey); err != nil {
		t.Fatalf("正确 publicKey 校验失败: %v", err)
	}

	if err := verifier.Verify(ctx, project.ID, "wrong-public-key"); !errors.Is(err, ingestion.ErrInvalidPublicKey) {
		t.Fatalf("错误 publicKey 的错误 = %v, want %v", err, ingestion.ErrInvalidPublicKey)
	}

	if err := tx.Model(&project).Update("enabled", false).Error; err != nil {
		t.Fatalf("禁用测试项目失败: %v", err)
	}

	if err := verifier.Verify(ctx, project.ID, project.PublicKey); !errors.Is(err, ingestion.ErrInvalidPublicKey) {
		t.Fatalf("已禁用项目的错误 = %v, want %v", err, ingestion.ErrInvalidPublicKey)
	}
}
