package telemetry

import (
	"errors"
	"strconv"
)

const (
	DefaultPageSize = 30
	MaxPageSize     = 100
	MaxPage         = 1_000_000
)

var (
	ErrInvalidPage     = errors.New("page must be an integer between 1 and 1000000")
	ErrInvalidPageSize = errors.New("pageSize must be an integer between 1 and 100")
)

// Pagination 是列表共用的页码参数，零值表示使用默认值。
type Pagination struct {
	Page     int
	PageSize int
}

type PageInfo struct {
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
	Total    uint64 `json:"total"`
}

func (p Pagination) Normalize() (Pagination, error) {
	if p.Page == 0 {
		p.Page = 1
	}
	if p.PageSize == 0 {
		p.PageSize = DefaultPageSize
	}
	if p.Page < 1 || p.Page > MaxPage {
		return Pagination{}, ErrInvalidPage
	}
	if p.PageSize < 1 || p.PageSize > MaxPageSize {
		return Pagination{}, ErrInvalidPageSize
	}
	return p, nil
}

func (p Pagination) Offset() int64 {
	return int64(p.Page-1) * int64(p.PageSize)
}

func (p Pagination) Info(total uint64) PageInfo {
	return PageInfo{Page: p.Page, PageSize: p.PageSize, Total: total}
}

func ParsePagination(pageText, sizeText string) (Pagination, error) {
	p := Pagination{}
	var err error
	if pageText != "" {
		p.Page, err = strconv.Atoi(pageText)
		if err != nil || p.Page < 1 {
			return Pagination{}, ErrInvalidPage
		}
	}
	if sizeText != "" {
		p.PageSize, err = strconv.Atoi(sizeText)
		if err != nil || p.PageSize < 1 {
			return Pagination{}, ErrInvalidPageSize
		}
	}
	return p.Normalize()
}
