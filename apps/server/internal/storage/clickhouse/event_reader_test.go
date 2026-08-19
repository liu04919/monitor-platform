package clickhouse

import (
	"encoding/json"
	"testing"
)

func TestStoredJSONShapes(t *testing.T) {
	object, err := storedJSONObject(` {"message":"boom"} `)
	if err != nil || !json.Valid(object) || object[0] != '{' {
		t.Fatalf("storedJSONObject() = %s, %v", object, err)
	}

	array, err := storedJSONArray(` [{"category":"click"}] `)
	if err != nil || !json.Valid(array) || array[0] != '[' {
		t.Fatalf("storedJSONArray() = %s, %v", array, err)
	}

	normalized, err := storedJSONArray("null")
	if err != nil || string(normalized) != "[]" {
		t.Fatalf("storedJSONArray(null) = %s, %v", normalized, err)
	}
}

func TestStoredJSONShapesRejectInvalidValues(t *testing.T) {
	tests := []struct {
		name  string
		value string
		parse func(string) (json.RawMessage, error)
	}{
		{name: "invalid JSON", value: "{", parse: storedJSONObject},
		{name: "payload is array", value: "[]", parse: storedJSONObject},
		{name: "breadcrumbs is object", value: "{}", parse: storedJSONArray},
		{name: "payload is null", value: "null", parse: storedJSONObject},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := test.parse(test.value); err == nil {
				t.Fatal("error = nil, want non-nil")
			}
		})
	}
}
