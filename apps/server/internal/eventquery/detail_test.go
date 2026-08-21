package eventquery

import (
	"context"
	"errors"
	"testing"
)

func TestServiceDetailReturnsEvent(t *testing.T) {
	store := &stubStore{
		detail: EventDetail{ProjectID: "project-1", EventID: "event-1"},
		found:  true,
	}

	detail, err := NewService(store, allowProject()).Detail(context.Background(), DetailRequest{
		UserID:    "user-1",
		ProjectID: " project-1 ",
		EventID:   " event-1 ",
	})
	if err != nil {
		t.Fatalf("Detail() error = %v", err)
	}
	if detail.EventID != "event-1" {
		t.Fatalf("detail = %#v", detail)
	}
	if store.getProjectID != "project-1" || store.getEventID != "event-1" {
		t.Fatalf("store arguments = %q, %q", store.getProjectID, store.getEventID)
	}
}

func TestServiceDetailValidatesIdentity(t *testing.T) {
	tests := []struct {
		name    string
		request DetailRequest
		wantErr error
	}{
		{name: "missing project ID", request: DetailRequest{EventID: "event-1"}, wantErr: ErrProjectIDRequired},
		{name: "missing event ID", request: DetailRequest{ProjectID: "project-1"}, wantErr: ErrInvalidEventID},
		{name: "event ID too long", request: DetailRequest{ProjectID: "project-1", EventID: string(make([]rune, maxIDLength+1))}, wantErr: ErrInvalidEventID},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &stubStore{}
			_, err := NewService(store, allowProject()).Detail(context.Background(), test.request)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Detail() error = %v, want %v", err, test.wantErr)
			}
			if store.getCalls != 0 {
				t.Fatalf("store get calls = %d, want 0", store.getCalls)
			}
		})
	}
}

func TestServiceDetailMapsNotFoundAndWrapsStoreError(t *testing.T) {
	t.Run("not found", func(t *testing.T) {
		store := &stubStore{}
		_, err := NewService(store, allowProject()).Detail(context.Background(), DetailRequest{
			UserID:    "user-1",
			ProjectID: "project-1",
			EventID:   "event-1",
		})
		if !errors.Is(err, ErrEventNotFound) {
			t.Fatalf("Detail() error = %v, want %v", err, ErrEventNotFound)
		}
	})

	t.Run("store error", func(t *testing.T) {
		storeError := errors.New("clickhouse unavailable")
		store := &stubStore{getErr: storeError}
		_, err := NewService(store, allowProject()).Detail(context.Background(), DetailRequest{
			UserID:    "user-1",
			ProjectID: "project-1",
			EventID:   "event-1",
		})
		if !errors.Is(err, storeError) {
			t.Fatalf("Detail() error = %v, want wrapped %v", err, storeError)
		}
	})
}
