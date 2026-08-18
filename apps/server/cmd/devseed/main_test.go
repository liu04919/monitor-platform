package main

import "testing"

func TestRunRejectsMissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	if err := run(); err == nil {
		t.Fatal("run() error = nil, want non-nil")
	}
}

func TestValueOrDefault(t *testing.T) {
	t.Setenv("DEVSEED_TEST_VALUE", " custom ")
	if value := valueOrDefault("DEVSEED_TEST_VALUE", "fallback"); value != "custom" {
		t.Fatalf("valueOrDefault() = %q, want %q", value, "custom")
	}

	t.Setenv("DEVSEED_TEST_VALUE", "   ")
	if value := valueOrDefault("DEVSEED_TEST_VALUE", "fallback"); value != "fallback" {
		t.Fatalf("valueOrDefault() = %q, want %q", value, "fallback")
	}
}
