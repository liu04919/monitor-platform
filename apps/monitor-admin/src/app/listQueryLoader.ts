import { readPagination } from '@/shared/lib/pagination'
import { redirect, type LoaderFunctionArgs } from 'react-router-dom'
import { presetTimeRange, withTimeRange } from '@/features/time-range/model/timeRange'

// 进入查询页面时固定默认时间并规范页码，URL 是筛选和分页的唯一来源。
export function listQueryLoader({ request }: Pick<LoaderFunctionArgs, 'request'>) {
  const url = new URL(request.url)
  if (!url.searchParams.has('from') && !url.searchParams.has('to')) {
    url.search = withTimeRange(url.searchParams, presetTimeRange('24h')).toString()
    return redirect(`${url.pathname}${url.search}`)
  }
  const pagination = readPagination(url.searchParams)
  let changed = false
  for (const key of ['page', 'pageSize'] as const) {
    if (url.searchParams.has(key) && url.searchParams.get(key) !== String(pagination[key])) {
      url.searchParams.set(key, String(pagination[key]))
      changed = true
    }
  }
  return changed ? redirect(`${url.pathname}${url.search}`) : null
}
