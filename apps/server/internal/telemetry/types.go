// telemetry 包定义 SDK 遥测协议模型及其业务校验规则。
package telemetry

import "encoding/json"

type SendType string

const (
	SendTypeFetch  SendType = "fetch"
	SendTypeBeacon SendType = "beacon"
)

type Category string

const (
	CategoryError       Category = "error"
	CategoryPerformance Category = "performance"
	CategoryBehavior    Category = "behavior"
	CategoryStability   Category = "stability"
	CategoryAI          Category = "ai"
)

type Level string

const (
	LevelError   Level = "error"
	LevelWarning Level = "warning"
)

type BreadcrumbCategory string

const (
	BreadcrumbCategoryClick      BreadcrumbCategory = "click"
	BreadcrumbCategoryNavigation BreadcrumbCategory = "navigation"
	BreadcrumbCategoryHTTP       BreadcrumbCategory = "http"
	BreadcrumbCategoryConsole    BreadcrumbCategory = "console"
	BreadcrumbCategoryCustom     BreadcrumbCategory = "custom"
)

type Batch struct {
	SchemaVersion int      `json:"schemaVersion"`
	BatchID       string   `json:"batchId"`
	SentAt        int64    `json:"sentAt"`
	PublicKey     string   `json:"publicKey"`
	App           App      `json:"app"`
	Events        []Event  `json:"events"`
	SendType      SendType `json:"sendType"`
}

type App struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Event struct {
	SchemaVersion    int             `json:"schemaVersion"`
	EventID          string          `json:"eventId"`
	Category         Category        `json:"category"`
	EventType        string          `json:"eventType"`
	Timestamp        int64           `json:"timestamp"`
	PageURL          string          `json:"pageUrl"`
	UserID           *string         `json:"userId"`
	Level            *Level          `json:"level"`
	Breadcrumbs      []Breadcrumb    `json:"breadcrumbs"`
	ReplayData       *string         `json:"replayData"`
	Payload          json.RawMessage `json:"payload"`
	IssueFingerprint string          `json:"-"`
}

type Breadcrumb struct {
	Timestamp int64              `json:"timestamp"`
	Category  BreadcrumbCategory `json:"category"`
	Message   *string            `json:"message"`
	Data      json.RawMessage    `json:"data"`
}
