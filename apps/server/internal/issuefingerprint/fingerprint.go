// issuefingerprint 包定义错误事件到稳定 Issue 身份的唯一映射规则。
package issuefingerprint

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/liu04919/monitor-platform/apps/server/internal/dto"
)

var (
	uuidPattern   = regexp.MustCompile(`(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
	urlPattern    = regexp.MustCompile(`https?://[^\s]+`)
	numberPattern = regexp.MustCompile(`[0-9]+`)
)

// Compute 为错误事件计算 128 位十六进制指纹；非错误事件不属于 Issue，返回空字符串。
func Compute(event dto.TelemetryEvent) (string, error) {
	if event.Category != dto.EventCategoryError {
		return "", nil
	}

	var payload fingerprintPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return "", fmt.Errorf("解析错误事件 payload: %w", err)
	}

	identity := []string{
		"v1",
		event.EventType,
		strings.TrimSpace(payload.Exception.Name),
		locationIdentity(event.EventType, payload),
	}
	sum := sha256.Sum256([]byte(strings.Join(identity, "\x00")))

	return hex.EncodeToString(sum[:16]), nil
}

type fingerprintPayload struct {
	Message   string             `json:"message"`
	Exception dto.ExceptionInfo  `json:"exception"`
	Resource  dto.ResourceInfo   `json:"resource"`
	Component *dto.ComponentInfo `json:"component"`
}

func locationIdentity(eventType string, payload fingerprintPayload) string {
	if eventType == "resource_error" {
		return strings.Join([]string{
			strings.ToLower(strings.TrimSpace(stringValue(payload.Resource.TagName))),
			normalizeURL(payload.Resource.URL),
		}, "\x00")
	}

	if len(payload.Exception.Stack) > 0 {
		frame := payload.Exception.Stack[0]
		if filename := strings.TrimSpace(stringValue(frame.Filename)); filename != "" {
			return strings.Join([]string{
				normalizeURL(filename),
				strings.TrimSpace(stringValue(frame.FunctionName)),
				intValue(frame.Line),
				intValue(frame.Column),
			}, "\x00")
		}
	}

	if payload.Component != nil {
		file := strings.TrimSpace(stringValue(payload.Component.File))
		name := strings.TrimSpace(stringValue(payload.Component.Name))
		if file != "" || name != "" {
			return strings.Join([]string{normalizeURL(file), name}, "\x00")
		}
	}

	message := payload.Message
	if strings.TrimSpace(message) == "" {
		message = payload.Exception.Message
	}
	if strings.TrimSpace(message) == "" {
		message = eventType
	}

	return normalizeMessage(message)
}

func normalizeURL(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	parsed, err := url.Parse(trimmed)
	if err == nil {
		parsed.Scheme = strings.ToLower(parsed.Scheme)
		parsed.Host = strings.ToLower(parsed.Host)
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String()
	}

	if index := strings.IndexAny(trimmed, "?#"); index >= 0 {
		return trimmed[:index]
	}
	return trimmed
}

func normalizeMessage(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = uuidPattern.ReplaceAllString(normalized, "<uuid>")
	normalized = urlPattern.ReplaceAllString(normalized, "<url>")
	normalized = numberPattern.ReplaceAllString(normalized, "#")
	return strings.Join(strings.Fields(normalized), " ")
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func intValue(value *int) string {
	if value == nil {
		return ""
	}
	return strconv.Itoa(*value)
}
