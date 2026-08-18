//go:build integration

package devseed_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/liu04919/monitor-platform/apps/server/internal/database"
	"github.com/liu04919/monitor-platform/apps/server/internal/devseed"
	postgresstore "github.com/liu04919/monitor-platform/apps/server/internal/storage/postgres"
)

func TestUpsertProjectWithPostgreSQL(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("未设置 TEST_DATABASE_URL，跳过本地项目 seed 集成测试")
	}

	ctx := context.Background()
	db, err := database.OpenPostgreSQL(ctx, database.PostgreSQLConfig{DSN: dsn})
	if err != nil {
		t.Fatalf("连接 PostgreSQL 失败: %v", err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatalf("获取 PostgreSQL 连接池失败: %v", err)
	}
	t.Cleanup(func() {
		_ = pool.Close()
	})

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	project := devseed.Project{
		ID:        "devseed-project-" + suffix,
		Name:      "第一次写入",
		PublicKey: "devseed-key-" + suffix,
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := db.WithContext(cleanupCtx).
			Where("id = ?", project.ID).
			Delete(&postgresstore.Project{}).
			Error; err != nil {
			t.Errorf("清理本地项目 seed 测试数据失败: %v", err)
		}
	})

	if err := devseed.UpsertProject(ctx, db, project); err != nil {
		t.Fatalf("第一次 UpsertProject() 失败: %v", err)
	}

	project.Name = "第二次写入"
	if err := devseed.UpsertProject(ctx, db, project); err != nil {
		t.Fatalf("第二次 UpsertProject() 失败: %v", err)
	}

	var projects []postgresstore.Project
	if err := db.WithContext(ctx).
		Where("id = ?", project.ID).
		Find(&projects).
		Error; err != nil {
		t.Fatalf("查询 seed 项目失败: %v", err)
	}
	if len(projects) != 1 {
		t.Fatalf("seed 项目数量 = %d, want 1", len(projects))
	}
	if projects[0].Name != project.Name {
		t.Fatalf("seed 项目名称 = %q, want %q", projects[0].Name, project.Name)
	}
	if !projects[0].Enabled {
		t.Fatal("seed 项目应保持启用状态")
	}
}
