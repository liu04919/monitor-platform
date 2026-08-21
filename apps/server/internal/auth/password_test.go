package auth

import "testing"

func TestArgon2IDPasswordHasher(t *testing.T) {
	hasher := Argon2IDPasswordHasher{}
	encoded, err := hasher.Hash("correct-password")
	if err != nil {
		t.Fatalf("Hash() error = %v", err)
	}
	if encoded == "correct-password" {
		t.Fatal("Hash() returned plaintext password")
	}

	matches, err := hasher.Matches("correct-password", encoded)
	if err != nil || !matches {
		t.Fatalf("Matches(correct) = %v, %v", matches, err)
	}
	matches, err = hasher.Matches("wrong-password", encoded)
	if err != nil || matches {
		t.Fatalf("Matches(wrong) = %v, %v", matches, err)
	}
}

func TestSecureTokenGenerator(t *testing.T) {
	generator := SecureTokenGenerator{}
	first, err := generator.Generate()
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	second, err := generator.Generate()
	if err != nil {
		t.Fatalf("Generate() second error = %v", err)
	}
	if len(first) != 43 {
		t.Fatalf("token length = %d, want 43", len(first))
	}
	if first == second {
		t.Fatal("two generated session tokens are equal")
	}
}
