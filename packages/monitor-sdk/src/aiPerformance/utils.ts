import type { AiStreamKind, AiStreamUrlMatcher } from './types'

export function createTraceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return String(input)
}

export function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

export function isReportUrl(url: string, reportUrl: string): boolean {
  const requestUrl = new URL(url, window.location.href)
  const targetUrl = new URL(reportUrl, window.location.href)

  return requestUrl.href === targetUrl.href
}

export function shouldTrackAiStream(
  url: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  patterns: AiStreamUrlMatcher[],
): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') {
      return url.includes(pattern)
    }

    if (pattern instanceof RegExp) {
      return pattern.test(url)
    }

    return pattern(url, input, init)
  })
}

export function getStreamKind(url: string): AiStreamKind {
  const requestUrl = new URL(url, window.location.href)

  if (/\/api\/chat\/[^/]+\/stream$/.test(requestUrl.pathname)) {
    return 'resume'
  }

  if (requestUrl.pathname.includes('/api/chat')) {
    return 'chat'
  }

  return 'custom'
}

export function getByteLength(value: Uint8Array): number {
  return value.byteLength
}
