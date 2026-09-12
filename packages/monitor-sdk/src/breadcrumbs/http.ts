import { safely } from '../common/safe'
import { sanitizeUrl } from '../common/sanitize'
import type { MonitorContext } from '../types'

export function isTelemetryRequest(ctx: MonitorContext, input: string): boolean {
  const target = new URL(input, location.href)
  const endpoint = new URL(ctx.getConfig().url, location.href)
  return target.origin === endpoint.origin && target.pathname === endpoint.pathname
}

// 复用已有网络采集器的完成结果；不再包一层 Fetch/XHR，不带请求体和响应体。
export function addHttpBreadcrumb(
  ctx: MonitorContext,
  request: { url: string; method: string; status: number; duration: number },
): void {
  safely(() => {
    const url = sanitizeUrl(request.url)
    if (!url || isTelemetryRequest(ctx, request.url)) return
    const method = request.method.toUpperCase()
    ctx.addBreadcrumb({
      category: 'http',
      message: `${method} ${url} ${request.status}`,
      data: { url, method, status: request.status, duration: Math.round(request.duration) },
    })
  })
}
