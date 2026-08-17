package migration

import (
	"testing"
	"testing/fstest"
)

func TestLoadMigrationsSortsByVersionedFilename(t *testing.T) {
	t.Parallel()

	files := fstest.MapFS{
		"000002_second.up.sql": {Data: []byte("SELECT 2")},
		"000001_first.up.sql":  {Data: []byte("SELECT 1")},
		"README.md":            {Data: []byte("ignored")},
	}

	migrations, err := loadMigrations(files, "*.up.sql")
	if err != nil {
		t.Fatalf("loadMigrations() error = %v", err)
	}
	if len(migrations) != 2 {
		t.Fatalf("len(migrations) = %d, want 2", len(migrations))
	}
	if migrations[0].version != 1 || migrations[1].version != 2 {
		t.Fatalf("migration versions = %d, %d, want 1, 2", migrations[0].version, migrations[1].version)
	}
}

func TestLoadMigrationsRejectsFilenameWithoutVersion(t *testing.T) {
	t.Parallel()

	_, err := loadMigrations(
		fstest.MapFS{"invalid.sql": {Data: []byte("SELECT 1")}},
		"*.sql",
	)
	if err == nil {
		t.Fatal("loadMigrations() error = nil, want non-nil")
	}
}
