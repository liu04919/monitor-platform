import { describe, expect, it } from 'vitest'
import {
  listSearch,
  localDateTime,
  parseLocalDateTime,
  presetTimeRange,
  readTimeRange,
  timePresets,
  withTimeRange,
} from './timeRange'
import { listQueryLoader } from '@/app/listQueryLoader'

describe('time range', () => {
  it('预设固定绝对时间，URL 往返保留毫秒', () => {
    for (const item of timePresets) {
      const range = presetTimeRange(item.value, 1789444800123)
      expect(range.to - range.from).toBe(item.duration)
      const params = withTimeRange(
        new URLSearchParams('category=error&page=4&pageSize=50&issuesPage=3'),
        range,
      )
      expect(readTimeRange(params)).toEqual(range)
      expect(params.get('category')).toBe('error')
      expect(params.has('page')).toBe(false)
      expect(params.has('issuesPage')).toBe(false)
      expect(params.get('pageSize')).toBe('50')
    }
  })

  it('拒绝缺失、颠倒、非整数和越界时间', () => {
    for (const query of [
      '',
      'from=1',
      'from=&to=10',
      'from=-1&to=2',
      'from=1.5&to=2',
      'from=2&to=1',
      'from=1&to=1',
      'from=0&to=4102444800001',
      'from=0x10&to=100',
    ]) {
      expect(readTimeRange(new URLSearchParams(query))).toBeNull()
    }
    expect(readTimeRange(new URLSearchParams('from=100&to=101&range=7d'))?.preset).toBe('custom')
  })

  it('缺省入口先写入最近 24 小时，已有时间不重算', () => {
    const result = listQueryLoader({
      request: new Request('http://localhost/events?category=error'),
    }) as Response
    const url = new URL(result.headers.get('Location')!, 'http://localhost')
    expect(result.status).toBe(302)
    expect(readTimeRange(url.searchParams)?.preset).toBe('24h')
    expect(url.searchParams.get('category')).toBe('error')
    expect(
      listQueryLoader({
        request: new Request('http://localhost/events?from=100&to=200'),
      }),
    ).toBeNull()
  })

  it('详情往返只携带列表字段', () => {
    expect(
      listSearch(
        new URLSearchParams(
          'from=100&to=200&range=custom&category=error&eventType=js_error&view=replay&issueId=abc&page=4&pageSize=50',
        ),
      ),
    ).toBe('?from=100&to=200&range=custom&category=error&eventType=js_error&page=4&pageSize=50')
  })

  it('自定义时间按本地时区转换，不默默归一化无效日期', () => {
    const timestamp = new Date(2026, 8, 15, 16, 20, 30).getTime()
    expect(parseLocalDateTime(localDateTime(timestamp))).toBe(timestamp)
    expect(parseLocalDateTime('2026-09-15T16:20')).toBe(new Date(2026, 8, 15, 16, 20).getTime())
    expect(parseLocalDateTime('2026-02-30T16:20')).toBeNaN()
    expect(parseLocalDateTime('invalid')).toBeNaN()
  })
})
