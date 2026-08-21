package auth

import (
	"crypto/rand"
	"encoding/base64"
)

const sessionTokenBytes = 32

type SecureTokenGenerator struct{}

func (SecureTokenGenerator) Generate() (string, error) {
	buffer := make([]byte, sessionTokenBytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(buffer), nil
}
