package auth

import "github.com/alexedwards/argon2id"

type Argon2IDPasswordHasher struct{}

func (Argon2IDPasswordHasher) Hash(password string) (string, error) {
	return argon2id.CreateHash(password, argon2id.DefaultParams)
}

func (Argon2IDPasswordHasher) Matches(password, encodedHash string) (bool, error) {
	return argon2id.ComparePasswordAndHash(password, encodedHash)
}
