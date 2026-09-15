package telemetry

import (
	"errors"
	"testing"
)

func TestParsePagination(t *testing.T) {
	for _, tc := range []struct {
		page, size string
		want       Pagination
		err        error
	}{
		{"", "", Pagination{1, 30}, nil},
		{"3", "20", Pagination{3, 20}, nil},
		{"1000000", "100", Pagination{1000000, 100}, nil},
		{"0", "30", Pagination{}, ErrInvalidPage},
		{"-1", "30", Pagination{}, ErrInvalidPage},
		{"2.5", "30", Pagination{}, ErrInvalidPage},
		{"abc", "30", Pagination{}, ErrInvalidPage},
		{"1000001", "30", Pagination{}, ErrInvalidPage},
		{"99999999999999999999", "30", Pagination{}, ErrInvalidPage},
		{"1", "0", Pagination{}, ErrInvalidPageSize},
		{"1", "101", Pagination{}, ErrInvalidPageSize},
		{"1", "-1", Pagination{}, ErrInvalidPageSize},
		{"1", "2.5", Pagination{}, ErrInvalidPageSize},
	} {
		t.Run(tc.page+"/"+tc.size, func(t *testing.T) {
			got, err := ParsePagination(tc.page, tc.size)
			if !errors.Is(err, tc.err) || got != tc.want {
				t.Fatalf("got %#v, %v; want %#v, %v", got, err, tc.want, tc.err)
			}
			if err == nil && got.Offset() != int64((got.Page-1)*got.PageSize) {
				t.Fatal("页码偏移错误")
			}
		})
	}
}
