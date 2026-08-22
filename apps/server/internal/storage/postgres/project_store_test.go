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
	listProjectsSQL  = `SELECT "id","name","enabled","created_at" FROM "projects" WHERE owner_user_id = $1 ORDER BY created_at ASC,id ASC`
	getProjectSQL    = `SELECT "id","owner_user_id","name","public_key","enabled","created_at" FROM "projects" WHERE id = $1 AND owner_user_id = $2 LIMIT $3`
	insertProjectSQL = `INSERT INTO "projects" ("id","owner_user_id","name","public_key","enabled","created_at","updated_at") VALUES ($1,$2,$3,$4,$5,$6,$7)`
)

func TestProjectStoreListsProjectsInStableOrder(t *testing.T) {
	database, mock := newMockDatabase(t)
	createdAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta(listProjectsSQL)).WithArgs("user-1").WillReturnRows(
		sqlmock.NewRows([]string{"id", "name", "enabled", "created_at"}).
			AddRow("project-1", "项目一", true, createdAt).
			AddRow("project-2", "项目二", false, createdAt.Add(time.Second)),
	)

	projects, err := NewProjectStore(database).List(context.Background(), "user-1")
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
	mock.ExpectQuery(regexp.QuoteMeta(listProjectsSQL)).WithArgs("user-1").WillReturnError(databaseError)

	_, err := NewProjectStore(database).List(context.Background(), "user-1")
	if !errors.Is(err, databaseError) {
		t.Fatalf("List() error = %v, want wrapped %v", err, databaseError)
	}
}

func TestProjectStoreGetsOwnedProjectWithPublicKey(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	createdAt := time.Date(2026, 8, 22, 1, 2, 3, 0, time.UTC)
	database, mock := newMockDatabase(t)
	mock.ExpectQuery(regexp.QuoteMeta(getProjectSQL)).
		WithArgs(projectID, "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_user_id", "name", "public_key", "enabled", "created_at"}).
			AddRow(projectID, "user-1", "Monitor Web", "pk_generated", true, createdAt))

	foundProject, err := NewProjectStore(database).Get(context.Background(), "user-1", projectID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if foundProject.ID != projectID || foundProject.OwnerUserID != "user-1" || foundProject.PublicKey != "pk_generated" {
		t.Fatalf("project = %#v", foundProject)
	}
}

func TestProjectStoreHidesMissingOrUnownedProject(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	database, mock := newMockDatabase(t)
	mock.ExpectQuery(regexp.QuoteMeta(getProjectSQL)).
		WithArgs(projectID, "other-user", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_user_id", "name", "public_key", "enabled", "created_at"}))

	_, err := NewProjectStore(database).Get(context.Background(), "other-user", projectID)
	if !errors.Is(err, projectdomain.ErrProjectNotFound) {
		t.Fatalf("Get() error = %v, want %v", err, projectdomain.ErrProjectNotFound)
	}
}

func TestProjectStoreCreatesProject(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	database, mock := newMockDatabase(t)
	createdAt := time.Date(2026, 8, 20, 1, 2, 3, 0, time.UTC)
	project := projectdomain.Project{
		ProjectSummary: projectdomain.ProjectSummary{
			ID:        projectID,
			Name:      "Monitor Web",
			Enabled:   true,
			CreatedAt: createdAt,
		},
		OwnerUserID: "user-1",
		PublicKey:   "pk_generated",
	}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(insertProjectSQL)).
		WithArgs(project.ID, project.OwnerUserID, project.Name, project.PublicKey, true, createdAt, createdAt).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := NewProjectStore(database).Create(context.Background(), project); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
}

func TestProjectStoreMapsDuplicateID(t *testing.T) {
	const projectID = "11111111-1111-4111-8111-111111111111"
	database, mock := newMockDatabase(t)
	createdAt := time.Date(2026, 8, 20, 1, 2, 3, 0, time.UTC)
	project := projectdomain.Project{
		ProjectSummary: projectdomain.ProjectSummary{
			ID:        projectID,
			Name:      "Monitor Web",
			Enabled:   true,
			CreatedAt: createdAt,
		},
		OwnerUserID: "user-1",
		PublicKey:   "pk_generated",
	}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(insertProjectSQL)).
		WithArgs(project.ID, project.OwnerUserID, project.Name, project.PublicKey, true, createdAt, createdAt).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: projectPrimaryKeyConstraint})
	mock.ExpectRollback()

	err := NewProjectStore(database).Create(context.Background(), project)
	if !errors.Is(err, projectdomain.ErrProjectIDCollision) {
		t.Fatalf("Create() error = %v, want %v", err, projectdomain.ErrProjectIDCollision)
	}
}
