package dto

import "encoding/json"

type ErrorMechanismType string

const (
	ErrorMechanismWindowOnError      ErrorMechanismType = "window.onerror"
	ErrorMechanismUnhandledRejection ErrorMechanismType = "unhandledrejection"
	ErrorMechanismResourceError      ErrorMechanismType = "resource.error"
	ErrorMechanismReactErrorBoundary ErrorMechanismType = "react.error_boundary"
	ErrorMechanismVueErrorHandler    ErrorMechanismType = "vue.error_handler"
)

type MetricUnit string

const (
	MetricUnitMilliseconds MetricUnit = "ms"
	MetricUnitBytes        MetricUnit = "bytes"
	MetricUnitCount        MetricUnit = "count"
)

type StackFrame struct {
	Filename     *string `json:"filename"`
	FunctionName *string `json:"functionName"`
	Line         *int    `json:"line"`
	Column       *int    `json:"column"`
}

type ErrorMechanism struct {
	Type    ErrorMechanismType `json:"type"`
	Handled *bool              `json:"handled"`
}

type ExceptionErrorPayload struct {
	Exception ExceptionInfo  `json:"exception"`
	Mechanism ErrorMechanism `json:"mechanism"`
	Component *ComponentInfo `json:"component"`
}

type ExceptionInfo struct {
	Name    string       `json:"name"`
	Message string       `json:"message"`
	Stack   []StackFrame `json:"stack"`
}

type ComponentInfo struct {
	Name  *string `json:"name"`
	File  *string `json:"file"`
	Stack *string `json:"stack"`
}

type ResourceErrorPayload struct {
	Message   string         `json:"message"`
	Resource  ResourceInfo   `json:"resource"`
	Mechanism ErrorMechanism `json:"mechanism"`
}

type ResourceInfo struct {
	URL     string  `json:"url"`
	TagName *string `json:"tagName"`
	Path    *string `json:"path"`
	HTML    *string `json:"html"`
}

type MetricPayload struct {
	Name       string          `json:"name"`
	Value      *float64        `json:"value"`
	Unit       MetricUnit      `json:"unit"`
	Attributes json.RawMessage `json:"attributes"`
}

type BehaviorPayload struct {
	Message *string         `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type StabilityPayload struct {
	Message string             `json:"message"`
	Metrics map[string]float64 `json:"metrics"`
}
