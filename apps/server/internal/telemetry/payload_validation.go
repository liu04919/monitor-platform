package telemetry

import (
	"encoding/json"
	"math"
	"strings"
)

func validateEventPayload(event Event, eventPrefix string) error {
	payloadField := eventPrefix + ".payload"

	switch event.Category {
	case CategoryError:
		if event.EventType == "resource_error" {
			var payload ResourceErrorPayload
			if err := decodePayload(event.Payload, &payload, payloadField); err != nil {
				return err
			}

			return validateResourceErrorPayload(payload, payloadField)
		}

		var payload ExceptionErrorPayload
		if err := decodePayload(event.Payload, &payload, payloadField); err != nil {
			return err
		}

		return validateExceptionErrorPayload(payload, payloadField)
	case CategoryPerformance, CategoryAI:
		var payload MetricPayload
		if err := decodePayload(event.Payload, &payload, payloadField); err != nil {
			return err
		}

		return validateMetricPayload(payload, payloadField)
	case CategoryBehavior:
		var payload BehaviorPayload
		if err := decodePayload(event.Payload, &payload, payloadField); err != nil {
			return err
		}

		return validateBehaviorPayload(payload, payloadField)
	case CategoryStability:
		var payload StabilityPayload
		if err := decodePayload(event.Payload, &payload, payloadField); err != nil {
			return err
		}

		return validateStabilityPayload(payload, payloadField)
	default:
		return nil
	}
}

func validateExceptionErrorPayload(payload ExceptionErrorPayload, prefix string) error {
	if strings.TrimSpace(payload.Exception.Name) == "" {
		return invalid(prefix+".exception.name", "is required")
	}
	if strings.TrimSpace(payload.Exception.Message) == "" {
		return invalid(prefix+".exception.message", "is required")
	}
	if payload.Exception.Stack == nil {
		return invalid(prefix+".exception.stack", "is required")
	}

	return validateErrorMechanism(payload.Mechanism, prefix+".mechanism")
}

func validateResourceErrorPayload(payload ResourceErrorPayload, prefix string) error {
	if strings.TrimSpace(payload.Message) == "" {
		return invalid(prefix+".message", "is required")
	}
	if strings.TrimSpace(payload.Resource.URL) == "" {
		return invalid(prefix+".resource.url", "is required")
	}

	return validateErrorMechanism(payload.Mechanism, prefix+".mechanism")
}

func validateErrorMechanism(mechanism ErrorMechanism, prefix string) error {
	switch mechanism.Type {
	case ErrorMechanismWindowOnError,
		ErrorMechanismUnhandledRejection,
		ErrorMechanismResourceError,
		ErrorMechanismReactErrorBoundary,
		ErrorMechanismVueErrorHandler:
	default:
		return invalid(prefix+".type", "is not supported")
	}

	if mechanism.Handled == nil {
		return invalid(prefix+".handled", "is required")
	}

	return nil
}

func validateMetricPayload(payload MetricPayload, prefix string) error {
	if strings.TrimSpace(payload.Name) == "" {
		return invalid(prefix+".name", "is required")
	}
	if payload.Value == nil {
		return invalid(prefix+".value", "is required")
	}
	if !isFinite(*payload.Value) {
		return invalid(prefix+".value", "must be a finite number")
	}

	switch payload.Unit {
	case MetricUnitMilliseconds, MetricUnitBytes, MetricUnitCount:
	default:
		return invalid(prefix+".unit", "must be ms, bytes, or count")
	}

	if len(payload.Attributes) > 0 && !isJSONObject(payload.Attributes) {
		return invalid(prefix+".attributes", "must be a JSON object when present")
	}

	return nil
}

func validateBehaviorPayload(payload BehaviorPayload, prefix string) error {
	if len(payload.Data) > 0 && !isJSONObject(payload.Data) {
		return invalid(prefix+".data", "must be a JSON object when present")
	}

	return nil
}

func validateStabilityPayload(payload StabilityPayload, prefix string) error {
	if strings.TrimSpace(payload.Message) == "" {
		return invalid(prefix+".message", "is required")
	}

	for name, value := range payload.Metrics {
		if !isFinite(value) {
			return invalid(prefix+".metrics."+name, "must be a finite number")
		}
	}

	return nil
}

func decodePayload(data json.RawMessage, destination any, field string) error {
	if err := json.Unmarshal(data, destination); err != nil {
		return invalid(field, "does not match the expected payload structure")
	}

	return nil
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
