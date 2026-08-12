import { createEventBase } from '../common/event'
import type { MonitorContext, PerformanceEvent } from '../types'

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

  function newFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = getFetchUrl(input)
    const config = ctx.getConfig()

    if (url === config.url) {
      return originalFetch.call(window, input, init)
    }

    const startTime = performance.now()
    const method = getFetchMethod(input, init)
    const params = getFetchParams(input, init)

    let status = 0
    let success = false

    return originalFetch
      .call(window, input, init)
      .then((response) => {
        status = response.status
        success = response.ok

        return response
      })
      .catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          typeof error.status === 'number'
        ) {
          status = error.status
        }

        success = false
        throw error
      })
      .finally(() => {
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
              url,
              method,
              status,
              success,
              params,
              startTime,
              endTime,
            },
          },
        }

        ctx.report(reportData)
      })
  }

  window.fetch = newFetch

  return () => {
    if (window.fetch === newFetch) {
      window.fetch = originalFetch
    }
  }
}
