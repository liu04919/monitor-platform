import { redirect, type LoaderFunctionArgs } from 'react-router-dom'
import { presetTimeRange, withTimeRange } from './timeRange'

// 进入列表时先把默认区间固定到 URL，组件不再单独保存一份筛选状态。
export function timeRangeLoader({ request }: Pick<LoaderFunctionArgs, 'request'>) {
  const url = new URL(request.url)
  if (!url.searchParams.has('from') && !url.searchParams.has('to')) {
    url.search = withTimeRange(url.searchParams, presetTimeRange('24h')).toString()
    return redirect(`${url.pathname}${url.search}`)
  }
  return null
}
