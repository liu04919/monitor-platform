import { describe, expect, it } from 'vitest'
import { readPagination } from './pagination'
import { listQueryLoader } from '@/app/listQueryLoader'

describe('页码参数', () => {
  it('默认第一页，每页 30 条，支持任意合法页大小', () => {
    expect(readPagination(new URLSearchParams())).toEqual({ page: 1, pageSize: 30 })
    expect(readPagination(new URLSearchParams('page=12&pageSize=20'))).toEqual({
      page: 12,
      pageSize: 20,
    })
  })

  it('非法 URL 参数归一化后重定向，地址与实际查询保持一致', () => {
    for (const query of [
      'page=-1&pageSize=101',
      'page=1.5&pageSize=abc',
      'page=1000001&pageSize=0',
    ]) {
      const result = listQueryLoader({
        request: new Request('http://localhost/events?from=100&to=200&' + query),
      }) as Response
      const params = new URL(result.headers.get('Location')!, 'http://localhost').searchParams
      expect(params.get('page')).toBe('1')
      expect(params.get('pageSize')).toBe('30')
      expect(params.get('from')).toBe('100')
      expect(params.get('to')).toBe('200')
    }
  })
})
