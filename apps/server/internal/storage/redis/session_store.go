// redis 包实现 Redis 临时状态存储。
package redis

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	redisclient "github.com/redis/go-redis/v9"

	"github.com/liu04919/monitor-platform/apps/server/internal/auth"
)

const sessionKeyPrefix = "monitor:session:"

type SessionStore struct {
	client redisclient.Cmdable
}

var _ auth.SessionStore = (*SessionStore)(nil)

func NewSessionStore(client redisclient.Cmdable) *SessionStore {
	return &SessionStore{client: client}
}

func (s *SessionStore) Create(
	ctx context.Context,
	token string,
	userID string,
	ttl time.Duration,
) error {
	if err := s.client.Set(ctx, sessionKey(token), userID, ttl).Err(); err != nil {
		return fmt.Errorf("set session: %w", err)
	}

	return nil
}

func (s *SessionStore) FindUserID(ctx context.Context, token string) (string, error) {
	userID, err := s.client.Get(ctx, sessionKey(token)).Result()
	if errors.Is(err, redisclient.Nil) {
		return "", auth.ErrSessionNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get session: %w", err)
	}

	return userID, nil
}

func (s *SessionStore) Delete(ctx context.Context, token string) error {
	if err := s.client.Del(ctx, sessionKey(token)).Err(); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	return nil
}

func sessionKey(token string) string {
	hash := sha256.Sum256([]byte(token))
	return sessionKeyPrefix + hex.EncodeToString(hash[:])
}
