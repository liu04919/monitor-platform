package postgres

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jackc/pgx/v5/pgconn"

	projectdomain "github.com/liu04919/monitor-platform/apps/server/internal/project"
)

const (
	listProjectsSQL  = `SELECT "id","name","enabled","created_at" FROM "projects" ORDER BY created_at ASC,id ASC`
	insertProjectSQL = `INSERT INTO "projects" ("id","name","public_key","enabled","created_at","updated_at") VALUES ($1,$2,$3,$4,$5,$6)`
)

func TestProjectStoreListsProjectsInStableOrder(t *testing.T) {
	database, mock := newMockDatabase(t)
	createdAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta(listProjectsSQL)).WillReturnRows(
		sqlmock.NewRows([]string{"id", "name", "enabled", "created_at"}).
			AddRow("project-1", "项目一", true, createdAt).
			AddRow("project-2", "项目二", false, createdAt.Add(time.Second)),
	)

	projects, err := NewProjectStore(database).List(context.Background())
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

func TestProjectStoreListPreservesDatabaseFailure(t *testing.T) {
	database, mock := newMockDatabase(t)
	databaseError := errors.New("database unavailable")
	mock.ExpectQuery(regexp.QuoteMeta(listProjectsSQL)).WillReturnError(databaseError)

	_, err := NewProjectStore(database).List(context.Background())
	if !errors.Is(err, databaseError) {
		t.Fatalf("List() error = %v, want wrapped %v", err, databaseError)
	}
}

func TestProjectStoreCreatesProject(t *testing.T) {
	database, mock := newMockDatabase(t)
	createdAt := time.Date(2026, 8, 20, 1, 2, 3, 0, time.UTC)
	project := projectdomain.Project{
		ProjectSummary: projectdomain.ProjectSummary{
			ID:        "monitor-web",
			Name:      "Monitor Web",
			Enabled:   true,
			CreatedAt: createdAt,
		},
		PublicKey: "pk_generated",
	}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(insertProjectSQL)).
		WithArgs(project.ID, project.Name, project.PublicKey, true, createdAt, createdAt).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := NewProjectStore(database).Create(context.Background(), project); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
}

func TestProjectStoreMapsDuplicateID(t *testing.T) {
	database, mock := newMockDatabase(t)
	createdAt := time.Date(2026, 8, 20, 1, 2, 3, 0, time.UTC)
	project := projectdomain.Project{
		ProjectSummary: projectdomain.ProjectSummary{
			ID:        "monitor-web",
			Name:      "Monitor Web",
			Enabled:   true,
			CreatedAt: createdAt,
		},
		PublicKey: "pk_generated",
	}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(insertProjectSQL)).
		WithArgs(project.ID, project.Name, project.PublicKey, true, createdAt, createdAt).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: projectPrimaryKeyConstraint})
	mock.ExpectRollback()

	err := NewProjectStore(database).Create(context.Background(), project)
	if !errors.Is(err, projectdomain.ErrProjectIDConflict) {
		t.Fatalf("Create() error = %v, want %v", err, projectdomain.ErrProjectIDConflict)
	}
}
