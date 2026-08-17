// migration 包按版本执行 PostgreSQL 和 ClickHouse 数据库迁移。
package migration

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"gorm.io/gorm"

	clickhousemigrations "github.com/liu04919/monitor-platform/apps/server/clickhouse"
	postgresmigrations "github.com/liu04919/monitor-platform/apps/server/migrations"
)

const (
	postgresMigrationTable = `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version BIGINT PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`
	clickHouseMigrationTable = `
		CREATE TABLE IF NOT EXISTS schema_migrations
		(
			version UInt64,
			name String,
			applied_at DateTime64(3, 'UTC') DEFAULT now64(3)
		)
		ENGINE = ReplacingMergeTree(applied_at)
		ORDER BY version
	`
)

type migrationFile struct {
	version uint64
	name    string
	sql     string
}

// Up 按文件名版本依次执行尚未应用的 PostgreSQL 和 ClickHouse 迁移。
func Up(ctx context.Context, postgresDB *gorm.DB, clickHouseConn driver.Conn) error {
	if err := upPostgreSQL(ctx, postgresDB); err != nil {
		return fmt.Errorf("迁移 PostgreSQL: %w", err)
	}

	if err := upClickHouse(ctx, clickHouseConn); err != nil {
		return fmt.Errorf("迁移 ClickHouse: %w", err)
	}

	return nil
}

func upPostgreSQL(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).Exec(postgresMigrationTable).Error; err != nil {
		return fmt.Errorf("创建迁移记录表: %w", err)
	}

	migrations, err := loadMigrations(postgresmigrations.Files(), "*.up.sql")
	if err != nil {
		return err
	}

	for _, item := range migrations {
		if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var applied bool
			if err := tx.Raw(
				"SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = ?)",
				item.version,
			).Scan(&applied).Error; err != nil {
				return fmt.Errorf("查询迁移 %s: %w", item.name, err)
			}
			if applied {
				return nil
			}

			if err := tx.Exec(item.sql).Error; err != nil {
				return fmt.Errorf("执行迁移 %s: %w", item.name, err)
			}
			if err := tx.Exec(
				"INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
				item.version,
				item.name,
			).Error; err != nil {
				return fmt.Errorf("记录迁移 %s: %w", item.name, err)
			}

			return nil
		}); err != nil {
			return err
		}
	}

	return nil
}

func upClickHouse(ctx context.Context, conn driver.Conn) error {
	if err := conn.Exec(ctx, clickHouseMigrationTable); err != nil {
		return fmt.Errorf("创建迁移记录表: %w", err)
	}

	migrations, err := loadMigrations(clickhousemigrations.Files(), "*.sql")
	if err != nil {
		return err
	}

	for _, item := range migrations {
		var applied uint64
		if err := conn.QueryRow(
			ctx,
			"SELECT count() FROM schema_migrations WHERE version = ?",
			item.version,
		).Scan(&applied); err != nil {
			return fmt.Errorf("查询迁移 %s: %w", item.name, err)
		}
		if applied > 0 {
			continue
		}

		if err := conn.Exec(ctx, item.sql); err != nil {
			return fmt.Errorf("执行迁移 %s: %w", item.name, err)
		}
		if err := conn.Exec(
			ctx,
			"INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
			item.version,
			item.name,
		); err != nil {
			return fmt.Errorf("记录迁移 %s: %w", item.name, err)
		}
	}

	return nil
}

func loadMigrations(files fs.FS, pattern string) ([]migrationFile, error) {
	names, err := fs.Glob(files, pattern)
	if err != nil {
		return nil, fmt.Errorf("查找迁移文件: %w", err)
	}
	sort.Strings(names)

	migrations := make([]migrationFile, 0, len(names))
	for _, name := range names {
		versionText, _, ok := strings.Cut(name, "_")
		if !ok {
			return nil, fmt.Errorf("迁移文件名缺少版本: %s", name)
		}

		version, err := strconv.ParseUint(versionText, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("解析迁移版本 %s: %w", name, err)
		}

		content, err := fs.ReadFile(files, name)
		if err != nil {
			return nil, fmt.Errorf("读取迁移 %s: %w", name, err)
		}

		migrations = append(migrations, migrationFile{
			version: version,
			name:    name,
			sql:     string(content),
		})
	}

	return migrations, nil
}
