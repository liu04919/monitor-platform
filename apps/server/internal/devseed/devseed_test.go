package devseed

import (
	"context"
	"strings"
	"testing"
)

func TestUpsertProjectRejectsMissingFields(t *testing.T) {
	tests := []struct {
		name          string
		project       Project
		wantErrorPart string
	}{
		{
			name:          "missing project ID",
			project:       Project{Name: "monitor", PublicKey: "pk_local"},
			wantErrorPart: "ID",
		},
		{
			name:          "missing project name",
			project:       Project{ID: "monitor-local", PublicKey: "pk_local"},
			wantErrorPart: "名称",
		},
		{
			name:          "missing public key",
			project:       Project{ID: "monitor-local", Name: "monitor"},
			wantErrorPart: "publicKey",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := UpsertProject(context.Background(), nil, test.project)
			if err == nil {
				t.Fatal("UpsertProject() error = nil, want non-nil")
			}
			if !strings.Contains(err.Error(), test.wantErrorPart) {
				t.Fatalf("UpsertProject() error = %q, want containing %q", err, test.wantErrorPart)
			}
		})
	}
}
