package postgres

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const listProjectsSQL = `SELECT "id","name","enabled","created_at" FROM "projects" ORDER BY created_at ASC,id ASC`

func TestProjectReaderListsProjectsInStableOrder(t *testing.T) {
	database, mock := newMockDatabase(t)
	createdAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta(listProjectsSQL)).WillReturnRows(
		sqlmock.NewRows([]string{"id", "name", "enabled", "created_at"}).
			AddRow("project-1", "项目一", true, createdAt).
			AddRow("project-2", "项目二", false, createdAt.Add(time.Second)),
	)

	projects, err := NewProjectReader(database).List(context.Background())
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(projects) != 2 {
		t.Fatalf("len(projects) = %d, want 2", len(projects))
	}
	if projects[0].ID != "project-1" || projects[1].Enabled {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestProjectReaderPreservesDatabaseFailure(t *testing.T) {
	database, mock := newMockDatabase(t)
	databaseError := errors.New("database unavailable")
	mock.ExpectQuery(regexp.QuoteMeta(listProjectsSQL)).WillReturnError(databaseError)

	_, err := NewProjectReader(database).List(context.Background())
	if !errors.Is(err, databaseError) {
		t.Fatalf("List() error = %v, want wrapped %v", err, databaseError)
	}
}
