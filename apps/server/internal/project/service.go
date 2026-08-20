// project 包负责管理端项目用例与业务规则，不包含 HTTP 鉴权或持久化实现。
package project

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const maxProjectFieldLength = 128

var (
	ErrInvalidProjectID   = errors.New("invalid project ID")
	ErrInvalidProjectName = errors.New("invalid project name")
	ErrProjectIDConflict  = errors.New("project ID already exists")
	projectIDPattern      = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$`)
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
	PublicKey string
}

type CreateRequest struct {
	ID   string
	Name string
}

// Store 在控制面存储中查询和创建项目。
type Store interface {
	List(ctx context.Context) ([]ProjectSummary, error)
	Create(ctx context.Context, project Project) error
}

type Service struct {
	store             Store
	generatePublicKey func() (string, error)
	now               func() time.Time
}

func NewService(store Store) *Service {
	return &Service{
		store:             store,
		generatePublicKey: securePublicKey,
		now:               time.Now,
	}
}

func (s *Service) List(ctx context.Context) ([]ProjectSummary, error) {
	projects, err := s.store.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("查询项目列表: %w", err)
	}

	return projects, nil
}

func (s *Service) Create(ctx context.Context, request CreateRequest) (Project, error) {
	projectID := strings.TrimSpace(request.ID)
	if utf8.RuneCountInString(projectID) > maxProjectFieldLength || !projectIDPattern.MatchString(projectID) {
		return Project{}, ErrInvalidProjectID
	}

	projectName := strings.TrimSpace(request.Name)
	if projectName == "" || utf8.RuneCountInString(projectName) > maxProjectFieldLength {
		return Project{}, ErrInvalidProjectName
	}

	publicKey, err := s.generatePublicKey()
	if err != nil {
		return Project{}, fmt.Errorf("生成项目 publicKey: %w", err)
	}

	project := Project{
		ProjectSummary: ProjectSummary{
			ID:        projectID,
			Name:      projectName,
			Enabled:   true,
			CreatedAt: s.now().UTC(),
		},
		PublicKey: publicKey,
	}
	if err := s.store.Create(ctx, project); err != nil {
		return Project{}, fmt.Errorf("创建项目: %w", err)
	}

	return project, nil
}

func securePublicKey() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	return "pk_" + base64.RawURLEncoding.EncodeToString(bytes), nil
}
