package telemetry

import (
	"errors"
	"testing"
)

func TestParseTimeRange(t *testing.T) {
	for _, pair := range [][2]string{{"", ""}, {"1", ""}, {"", "2"}, {"NaN", "2"}, {"1.5", "2"}, {"-1", "2"}, {"2", "2"}, {"3", "2"}, {"1", "4102444800001"}, {"999999999999999999999", "2"}} {
		if _, err := ParseTimeRange(pair[0], pair[1]); !errors.Is(err, ErrInvalidTimeRange) {
			t.Fatalf("ParseTimeRange(%q, %q) error = %v", pair[0], pair[1], err)
		}
	}
	rangeValue, err := ParseTimeRange("1789444800123", "1789444800124")
	if err != nil || rangeValue.From != 1789444800123 || rangeValue.To != 1789444800124 {
		t.Fatalf("毫秒精度丢失: %#v, %v", rangeValue, err)
	}
	if _, err := ParseTimeRange("0", "4102444800000"); err != nil {
		t.Fatal(err)
	}
}
