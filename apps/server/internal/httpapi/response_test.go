package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestWriteError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)

	WriteError(
		context,
		http.StatusUnprocessableEntity,
		"INVALID_FIELD",
		"字段无效",
		&ErrorDetails{Field: "name"},
	)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnprocessableEntity)
	}

	var response ErrorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Error.Code != "INVALID_FIELD" || response.Error.Message != "字段无效" {
		t.Fatalf("error = %#v", response.Error)
	}
	if response.Error.Details == nil || response.Error.Details.Field != "name" {
		t.Fatalf("details = %#v", response.Error.Details)
	}
}

func TestIsJSONContentType(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "plain JSON", value: "application/json", want: true},
		{name: "JSON with charset", value: "application/json; charset=utf-8", want: true},
		{name: "missing", value: "", want: false},
		{name: "different media type", value: "text/plain", want: false},
		{name: "malformed", value: `application/json; charset="`, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsJSONContentType(test.value); got != test.want {
				t.Fatalf("IsJSONContentType(%q) = %t, want %t", test.value, got, test.want)
			}
		})
	}
}
