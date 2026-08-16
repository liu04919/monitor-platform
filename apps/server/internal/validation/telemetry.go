package validation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

const (
	schemaVersion      = 2
	maxIDLength        = 128
	maxPublicKeyLength = 128
	maxAppNameLength   = 128
	maxPageURLLength   = 4096
	maxEventsPerBatch  = 100
)

var eventTypesByCategory = map[dto.EventCategory]map[string]struct{}{
	dto.EventCategoryError: {
		"js_error":            {},
		"unhandled_rejection": {},
		"cors_error":          {},
		"react_error":         {},
		"vue_error":           {},
		"resource_error":      {},
	},
	dto.EventCategoryPerformance: {
		"web_vital":       {},
		"page_load":       {},
		"http_request":    {},
		"resource_timing": {},
		"react_render":    {},
	},
	dto.EventCategoryBehavior: {
		"page_view":    {},
		"route_change": {},
		"click":        {},
		"custom":       {},
	},
	dto.EventCategoryStability: {
		"white_screen": {},
		"stutter":      {},
		"crash":        {},
	},
	dto.EventCategoryAI: {
		"stream_metric": {},
		"stream_stall":  {},
	},
}

type FieldError struct {
	Field   string
	Message string
}

func (e *FieldError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

func ValidateTelemetryBatch(batch dto.TelemetryBatch) error {
	if batch.SchemaVersion != schemaVersion {
		return invalid("schemaVersion", "must be 2")
	}
	if err := validateRequiredString("batchId", batch.BatchID, maxIDLength); err != nil {
		return err
	}
	if batch.SentAt < 0 {
		return invalid("sentAt", "must be a non-negative Unix millisecond timestamp")
	}
	if err := validateRequiredString("publicKey", batch.PublicKey, maxPublicKeyLength); err != nil {
		return err
	}
	if err := validateRequiredString("app.id", batch.App.ID, maxIDLength); err != nil {
		return err
	}
	if err := validateRequiredString("app.name", batch.App.Name, maxAppNameLength); err != nil {
		return err
	}
	if len(batch.Events) < 1 || len(batch.Events) > maxEventsPerBatch {
		return invalid("events", "must contain between 1 and 100 events")
	}
	if batch.SendType != dto.SendTypeFetch && batch.SendType != dto.SendTypeBeacon {
		return invalid("sendType", "must be fetch or beacon")
	}

	for index, event := range batch.Events {
		if err := validateTelemetryEvent(event, index); err != nil {
			return err
		}
	}

	return nil
}

func validateTelemetryEvent(event dto.TelemetryEvent, index int) error {
	prefix := fmt.Sprintf("events[%d]", index)

	if event.SchemaVersion != schemaVersion {
		return invalid(prefix+".schemaVersion", "must be 2")
	}
	if err := validateRequiredString(prefix+".eventId", event.EventID, maxIDLength); err != nil {
		return err
	}

	allowedEventTypes, ok := eventTypesByCategory[event.Category]
	if !ok {
		return invalid(prefix+".category", "is not supported")
	}
	if _, ok := allowedEventTypes[event.EventType]; !ok {
		return invalid(
			prefix+".eventType",
			fmt.Sprintf("%s is not valid for category %s", event.EventType, event.Category),
		)
	}
	if event.Timestamp < 0 {
		return invalid(prefix+".timestamp", "must be a non-negative Unix millisecond timestamp")
	}
	if utf8.RuneCountInString(event.PageURL) > maxPageURLLength {
		return invalid(prefix+".pageUrl", "must not exceed 4096 characters")
	}
	if event.UserID != nil && utf8.RuneCountInString(*event.UserID) > maxIDLength {
		return invalid(prefix+".userId", "must not exceed 128 characters")
	}

	if event.Category == dto.EventCategoryError || event.Category == dto.EventCategoryStability {
		if event.Level == nil {
			return invalid(prefix+".level", "is required for error and stability events")
		}
		if *event.Level != dto.EventLevelError && *event.Level != dto.EventLevelWarning {
			return invalid(prefix+".level", "must be error or warning")
		}
		// A nil slice means the field was missing or null; an empty array is valid.
		if event.Breadcrumbs == nil {
			return invalid(prefix+".breadcrumbs", "is required for error and stability events")
		}
	}

	for breadcrumbIndex, breadcrumb := range event.Breadcrumbs {
		if err := validateBreadcrumb(breadcrumb, prefix, breadcrumbIndex); err != nil {
			return err
		}
	}

	if !isJSONObject(event.Payload) {
		return invalid(prefix+".payload", "must be a JSON object")
	}
	if err := validateEventPayload(event, prefix); err != nil {
		return err
	}

	return nil
}

func validateBreadcrumb(breadcrumb dto.Breadcrumb, eventPrefix string, index int) error {
	prefix := fmt.Sprintf("%s.breadcrumbs[%d]", eventPrefix, index)

	if breadcrumb.Timestamp < 0 {
		return invalid(prefix+".timestamp", "must be a non-negative Unix millisecond timestamp")
	}

	switch breadcrumb.Category {
	case dto.BreadcrumbCategoryClick,
		dto.BreadcrumbCategoryNavigation,
		dto.BreadcrumbCategoryHTTP,
		dto.BreadcrumbCategoryConsole,
		dto.BreadcrumbCategoryCustom:
	default:
		return invalid(prefix+".category", "is not supported")
	}

	if len(breadcrumb.Data) > 0 && !isJSONObject(breadcrumb.Data) {
		return invalid(prefix+".data", "must be a JSON object when present")
	}

	return nil
}

func validateRequiredString(field, value string, maxLength int) error {
	if strings.TrimSpace(value) == "" {
		return invalid(field, "is required")
	}
	if utf8.RuneCountInString(value) > maxLength {
		return invalid(field, fmt.Sprintf("must not exceed %d characters", maxLength))
	}

	return nil
}

func isJSONObject(data json.RawMessage) bool {
	trimmed := bytes.TrimSpace(data)

	return len(trimmed) >= 2 &&
		trimmed[0] == '{' &&
		trimmed[len(trimmed)-1] == '}' &&
		json.Valid(trimmed)
}

func invalid(field, message string) error {
	return &FieldError{
		Field:   field,
		Message: message,
	}
}
