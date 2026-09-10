import { createEventBase } from '../common/event'
import { safely } from '../common/safe'
import type { MonitorContext, PerformanceEvent } from '../types'

// 浏览器只有一个 Fetch 入口；记录本插件包装链，允许实例按任意顺序销毁。
const wrappers = new WeakMap<
  typeof window.fetch,
  { original: typeof window.fetch; active: () => boolean }
>()

function getFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return String(input)
}

function getFetchMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function serializeBody(body: BodyInit | null | undefined): string {
  if (body == null) return ''
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) {
    return body.toString()
  }

  if (body instanceof FormData) {
    const result: Record<string, string[]> = {}

    for (const [key, value] of body.entries()) {
      if (!result[key]) {
        result[key] = []
      }

      result[key].push(typeof value === 'string' ? value : `[File:${value.name}]`)
    }

    return JSON.stringify(result)
  }

  if (body instanceof Blob) {
    return `[Blob size=${body.size} type=${body.type}]`
  }

  if (body instanceof ArrayBuffer) {
    return `[ArrayBuffer byteLength=${body.byteLength}]`
  }

  return '[Unsupported Body]'
}

function getFetchParams(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.body != null) {
    return serializeBody(init.body)
  }

  if (input instanceof Request) {
    return '[Request body not readable synchronously]'
  }

  const url = new URL(getFetchUrl(input), window.location.href)

  return JSON.stringify(Object.fromEntries(url.searchParams.entries()))
}

export default function fetch(ctx: MonitorContext): () => void {
  if (typeof window.fetch !== 'function') {
    return () => {}
  }

  const originalFetch = window.fetch
  let active = true

  function newFetch(this: Window, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const startTime = performance.now()
    // 原请求的参数、this、Response 和异常都原样传递；不读取响应体。
    const request = originalFetch.call(this, input, init)
    let metadata: { url: string; method: string; params: string } | undefined
    safely(() => {
      if (!active) return
      const url = getFetchUrl(input)
      if (
        new URL(url, window.location.href).href ===
        new URL(ctx.getConfig().url, window.location.href).href
      )
        return
      metadata = { url, method: getFetchMethod(input, init), params: getFetchParams(input, init) }
    })
    if (!metadata) return request

    const report = (status: number, success: boolean): void => {
      safely(() => {
        if (!active || !metadata) return
        const endTime = performance.now()
        const duration = endTime - startTime

        const reportData: PerformanceEvent = {
          ...createEventBase(ctx),

          category: 'performance',
          eventType: 'http_request',

          payload: {
            name: 'fetch',
            value: duration,
            unit: 'ms',

            attributes: {
              url: metadata.url,
              method: metadata.method,
              status,
              success,
              params: metadata.params,
              startTime,
              endTime,
            },
          },
        }

        ctx.report(reportData)
      })
    }
    // 不在 finally 中上报：监控异常绝不能替换业务请求的完成结果。
    return request.then(
      (response) => {
        report(response.status, response.ok)
        return response
      },
      (error: unknown) => {
        report(0, false)
        throw error
      },
    )
  }

  window.fetch = newFetch
  wrappers.set(newFetch, { original: originalFetch, active: () => active })

  return () => {
    active = false
    if (window.fetch === newFetch) {
      let restored = originalFetch
      while (wrappers.has(restored) && !wrappers.get(restored)!.active()) {
        restored = wrappers.get(restored)!.original
      }
      window.fetch = restored
    }
  }
}
