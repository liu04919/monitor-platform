import { createEventBase } from '../common/event'
import { urlToJson } from '../common/utils'
import type { MonitorContext, PerformanceEvent } from '../types'

declare global {
  interface XMLHttpRequest {
    method?: string
    url?: string
  }
}

function serializeBody(body: Document | XMLHttpRequestBodyInit | null | undefined): string {
  if (body == null) return ''

  if (typeof body === 'string') return body

  if (body instanceof URLSearchParams) {
    return body.toString()
  }

  if (body instanceof FormData) {
    const result: Record<string, string[]> = {}

    for (const [key, value] of body.entries()) {
      if (!result[key]) result[key] = []
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

  if (ArrayBuffer.isView(body)) {
    return `[ArrayBufferView byteLength=${body.byteLength}]`
  }

  if (body instanceof Document) {
    return '[Document]'
  }

  return '[Unsupported Body]'
}

export default function xhr(ctx: MonitorContext): () => void {
  const originalProto = XMLHttpRequest.prototype
  const originalSend = originalProto.send
  const originalOpen = originalProto.open

  function newOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    this.url = url.toString()
    this.method = method

    return originalOpen.apply(this, [method, url, async, username, password] as Parameters<
      XMLHttpRequest['open']
    >)
  }

  function newSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const startTime = performance.now()

    const onLoaded = () => {
      const endTime = performance.now()
      const duration = endTime - startTime
      const url = this.url || ''
      const method = this.method || 'GET'
      const params = body != null ? serializeBody(body) : urlToJson(url)

      const reportData: PerformanceEvent = {
        ...createEventBase(ctx),

        category: 'performance',
        eventType: 'http_request',

        payload: {
          name: 'xhr',
          value: duration,
          unit: 'ms',

          attributes: {
            url,
            method: method.toUpperCase(),
            status: this.status,
            success: this.status >= 200 && this.status < 300,
            params,
            startTime,
            endTime,
          },
        },
      }

      ctx.report(reportData)
    }

    this.addEventListener('loadend', onLoaded, { once: true })

    return originalSend.apply(this, [body])
  }

  originalProto.open = newOpen
  originalProto.send = newSend

  return () => {
    if (originalProto.open === newOpen) {
      originalProto.open = originalOpen
    }

    if (originalProto.send === newSend) {
      originalProto.send = originalSend
    }
  }
}
