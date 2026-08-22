// project 包负责管理端项目用例与业务规则，不包含 HTTP 鉴权或持久化实现。
package project

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	maxProjectFieldLength       = 128
	maxProjectIDGenerateRetries = 3
)

var (
	ErrInvalidProjectName  = errors.New("invalid project name")
	ErrProjectIDCollision  = errors.New("generated project ID collided")
	ErrOwnerUserIDRequired = errors.New("owner user ID is required")
)

// ProjectSummary 是管理端项目选择器需要的最小项目信息。
// publicKey 不属于项目读取接口的展示字段，因此不会进入该模型。
type ProjectSummary struct {
	ID        string
	Name      string
	Enabled   bool
	CreatedAt time.Time
}

// Project 是创建项目时写入控制面的完整记录。
// publicKey 会返回给管理端用于配置 SDK，但不会进入列表投影。
type Project struct {
	ProjectSummary
	OwnerUserID string
	PublicKey   string
}

type CreateRequest struct {
	Name string
}

// Store 在控制面存储中查询和创建项目。
type Store interface {
	List(ctx context.Context, ownerUserID string) ([]ProjectSummary, error)
	Create(ctx context.Context, project Project) error
	Owns(ctx context.Context, ownerUserID, projectID string) (bool, error)
}

type Service struct {
	store             Store
	generateProjectID func() (string, error)
	generatePublicKey func() (string, error)
	now               func() time.Time
}

func NewService(store Store) *Service {
	return &Service{
		store:             store,
		generateProjectID: secureProjectID,
		generatePublicKey: securePublicKey,
		now:               time.Now,
	}
}

func (s *Service) List(ctx context.Context, ownerUserID string) ([]ProjectSummary, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID == "" {
		return nil, ErrOwnerUserIDRequired
	}

	projects, err := s.store.List(ctx, ownerUserID)
	if err != nil {
		return nil, fmt.Errorf("查询项目列表: %w", err)
	}

	return projects, nil
}

func (s *Service) Create(ctx context.Context, ownerUserID string, request CreateRequest) (Project, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID == "" {
		return Project{}, ErrOwnerUserIDRequired
	}

	projectName := strings.TrimSpace(request.Name)
	if projectName == "" || utf8.RuneCountInString(projectName) > maxProjectFieldLength {
		return Project{}, ErrInvalidProjectName
	}

	publicKey, err := s.generatePublicKey()
	if err != nil {
		return Project{}, fmt.Errorf("生成项目 publicKey: %w", err)
	}

	for attempt := 0; attempt < maxProjectIDGenerateRetries; attempt++ {
		projectID, err := s.generateProjectID()
		if err != nil {
			return Project{}, fmt.Errorf("生成项目 ID: %w", err)
		}

		project := Project{
			ProjectSummary: ProjectSummary{
				ID:        projectID,
				Name:      projectName,
				Enabled:   true,
				CreatedAt: s.now().UTC(),
			},
			OwnerUserID: ownerUserID,
			PublicKey:   publicKey,
		}
		if err := s.store.Create(ctx, project); err == nil {
			return project, nil
		} else if !errors.Is(err, ErrProjectIDCollision) {
			return Project{}, fmt.Errorf("创建项目: %w", err)
		}
	}

	return Project{}, fmt.Errorf("生成唯一项目 ID: %w", ErrProjectIDCollision)
}

// CanAccess 判断指定用户是否拥有项目，供管理端项目下资源统一授权。
func (s *Service) CanAccess(ctx context.Context, ownerUserID, projectID string) (bool, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	projectID = strings.TrimSpace(projectID)
	if ownerUserID == "" || uuid.Validate(projectID) != nil {
		return false, nil
	}

	owned, err := s.store.Owns(ctx, ownerUserID, projectID)
	if err != nil {
		return false, fmt.Errorf("校验项目归属: %w", err)
	}
	return owned, nil
}

func securePublicKey() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	return "pk_" + base64.RawURLEncoding.EncodeToString(bytes), nil
}

func secureProjectID() (string, error) {
	projectID, err := uuid.NewRandom()
	if err != nil {
		return "", err
	}
	return projectID.String(), nil
}
