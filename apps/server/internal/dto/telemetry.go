package dto

import "encoding/json"

type SendType string

const (
	SendTypeFetch  SendType = "fetch"
	SendTypeBeacon SendType = "beacon"
)

type EventCategory string

const (
	EventCategoryError       EventCategory = "error"
	EventCategoryPerformance EventCategory = "performance"
	EventCategoryBehavior    EventCategory = "behavior"
	EventCategoryStability   EventCategory = "stability"
	EventCategoryAI          EventCategory = "ai"
)

type EventLevel string

const (
	EventLevelError   EventLevel = "error"
	EventLevelWarning EventLevel = "warning"
)

type BreadcrumbCategory string

const (
	BreadcrumbCategoryClick      BreadcrumbCategory = "click"
	BreadcrumbCategoryNavigation BreadcrumbCategory = "navigation"
	BreadcrumbCategoryHTTP       BreadcrumbCategory = "http"
	BreadcrumbCategoryConsole    BreadcrumbCategory = "console"
	BreadcrumbCategoryCustom     BreadcrumbCategory = "custom"
)

type TelemetryBatch struct {
	SchemaVersion int              `json:"schemaVersion"`
	BatchID       string           `json:"batchId"`
	SentAt        int64            `json:"sentAt"`
	PublicKey     string           `json:"publicKey"`
	App           App              `json:"app"`
	Events        []TelemetryEvent `json:"events"`
	SendType      SendType         `json:"sendType"`
}

type App struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type TelemetryEvent struct {
	SchemaVersion int             `json:"schemaVersion"`
	EventID       string          `json:"eventId"`
	Category      EventCategory   `json:"category"`
	EventType     string          `json:"eventType"`
	Timestamp     int64           `json:"timestamp"`
	PageURL       string          `json:"pageUrl"`
	UserID        *string         `json:"userId"`
	Level         *EventLevel     `json:"level"`
	Breadcrumbs   []Breadcrumb    `json:"breadcrumbs"`
	ReplayData    *string         `json:"replayData"`
	Payload       json.RawMessage `json:"payload"`
}

type Breadcrumb struct {
	Timestamp int64              `json:"timestamp"`
	Category  BreadcrumbCategory `json:"category"`
	Message   *string            `json:"message"`
	Data      json.RawMessage    `json:"data"`
}
