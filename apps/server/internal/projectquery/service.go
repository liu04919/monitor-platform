// projectquery 包负责管理端项目读取规则，不包含 HTTP 鉴权或持久化实现。
package projectquery

import (
	"context"
	"fmt"
	"time"
)

// ProjectSummary 是管理端项目选择器需要的最小项目信息。
// publicKey 不属于项目读取接口的展示字段，因此不会进入该模型。
type ProjectSummary struct {
	ID        string
	Name      string
	Enabled   bool
	CreatedAt time.Time
}

// Store 从控制面存储中读取项目。
type Store interface {
	List(ctx context.Context) ([]ProjectSummary, error)
}

type Service struct {
	store Store
}

func NewService(store Store) *Service {
	return &Service{store: store}
}

func (s *Service) List(ctx context.Context) ([]ProjectSummary, error) {
	projects, err := s.store.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("查询项目列表: %w", err)
	}

	return projects, nil
}
