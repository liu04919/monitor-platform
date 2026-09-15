package telemetry

import (
	"errors"
	"strconv"
)

var ErrInvalidTimeRange = errors.New("from and to must be Unix milliseconds with 0 <= from < to <= 4102444800000")

// TimeRange 使用左闭右开区间 [From, To)，单位为 Unix 毫秒。
// 查询时固定两端，翻页不会因当前时间变化而移动窗口。
type TimeRange struct {
	From int64
	To   int64
}

func (r TimeRange) Validate() error {
	// 2100 年上限保持在 ClickHouse DateTime64 的有效范围内。
	if r.From < 0 || r.To <= r.From || r.To > 4102444800000 {
		return ErrInvalidTimeRange
	}
	return nil
}

func ParseTimeRange(from, to string) (TimeRange, error) {
	start, startErr := strconv.ParseInt(from, 10, 64)
	end, endErr := strconv.ParseInt(to, 10, 64)
	if startErr != nil || endErr != nil {
		return TimeRange{}, ErrInvalidTimeRange
	}
	r := TimeRange{From: start, To: end}
	return r, r.Validate()
}
