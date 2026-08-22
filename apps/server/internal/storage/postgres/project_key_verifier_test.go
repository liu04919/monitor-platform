package postgres

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/liu04919/monitor-platform/apps/server/internal/ingestion"
)

const verifyProjectKeySQL = `SELECT "id" FROM "projects" WHERE id = $1 AND public_key = $2 AND enabled = $3 LIMIT $4`
const verifierProjectID = "11111111-1111-4111-8111-111111111111"

func TestProjectKeyVerifierAcceptsEnabledMatchingProject(t *testing.T) {
	database, mock := newMockDatabase(t)
	mock.ExpectQuery(regexp.QuoteMeta(verifyProjectKeySQL)).
		WithArgs(verifierProjectID, "pk_monitor_web_demo", true, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(verifierProjectID))

	verifier := NewProjectKeyVerifier(database)
	if err := verifier.Verify(
		context.Background(),
		verifierProjectID,
		"pk_monitor_web_demo",
	); err != nil {
		t.Fatalf("verify project key: %v", err)
	}

}

func TestProjectKeyVerifierRejectsMissingDisabledOrMismatchedProject(t *testing.T) {
	database, mock := newMockDatabase(t)
	mock.ExpectQuery(regexp.QuoteMeta(verifyProjectKeySQL)).
		WithArgs(verifierProjectID, "wrong-key", true, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	verifier := NewProjectKeyVerifier(database)
	err := verifier.Verify(context.Background(), verifierProjectID, "wrong-key")
	if !errors.Is(err, ingestion.ErrInvalidPublicKey) {
		t.Fatalf("expected invalid public key error, got %v", err)
	}

}

func TestProjectKeyVerifierPreservesDatabaseFailure(t *testing.T) {
	database, mock := newMockDatabase(t)
	databaseError := errors.New("database unavailable")
	mock.ExpectQuery(regexp.QuoteMeta(verifyProjectKeySQL)).
		WithArgs(verifierProjectID, "pk_monitor_web_demo", true, 1).
		WillReturnError(databaseError)

	verifier := NewProjectKeyVerifier(database)
	err := verifier.Verify(
		context.Background(),
		verifierProjectID,
		"pk_monitor_web_demo",
	)
	if !errors.Is(err, databaseError) {
		t.Fatalf("expected database error, got %v", err)
	}
	if errors.Is(err, ingestion.ErrInvalidPublicKey) {
		t.Fatalf("database failure must not be reported as an invalid public key")
	}

}

func TestProjectKeyVerifierRejectsInvalidProjectIDBeforeQuery(t *testing.T) {
	database, _ := newMockDatabase(t)
	err := NewProjectKeyVerifier(database).Verify(context.Background(), "caller-chosen-id", "pk_value")
	if !errors.Is(err, ingestion.ErrInvalidPublicKey) {
		t.Fatalf("Verify() error = %v, want %v", err, ingestion.ErrInvalidPublicKey)
	}
}

func newMockDatabase(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()

	sqlDatabase, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create SQL mock: %v", err)
	}
	t.Cleanup(func() {
		mock.ExpectClose()
		if err := sqlDatabase.Close(); err != nil {
			t.Errorf("close SQL mock: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("verify SQL expectations: %v", err)
		}
	})

	database, err := gorm.Open(
		postgres.New(postgres.Config{
			Conn:                 sqlDatabase,
			PreferSimpleProtocol: true,
		}),
		&gorm.Config{
			DisableAutomaticPing: true,
			Logger:               logger.Default.LogMode(logger.Silent),
		},
	)
	if err != nil {
		t.Fatalf("open GORM database: %v", err)
	}

	return database, mock
}
