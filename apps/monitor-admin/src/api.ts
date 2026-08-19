import type { EventDetail, EventFilters, EventListData } from './types'

const API_PREFIX = '/management-api/api/v1'

interface APIEnvelope<T> {
  data: T
}

interface APIErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
}

export class APIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    let body: APIErrorEnvelope | undefined
    try {
      body = (await response.json()) as APIErrorEnvelope
    } catch {
      body = undefined
    }

    const fallback = response.status === 401
      ? '管理端鉴权失败，请确认 Go 服务和 Vite 使用了相同的 MANAGEMENT_API_TOKEN。'
      : `请求失败（HTTP ${response.status}）`
    throw new APIError(body?.error?.message || fallback, response.status, body?.error?.code)
  }

  return ((await response.json()) as APIEnvelope<T>).data
}

export function listEvents(
  projectId: string,
  filters: EventFilters,
  cursor: string,
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({ limit: '30' })
  if (filters.category) parameters.set('category', filters.category)
  if (filters.eventType.trim()) parameters.set('eventType', filters.eventType.trim())
  if (cursor) parameters.set('cursor', cursor)

  return request<EventListData>(
    `/projects/${encodeURIComponent(projectId)}/events?${parameters.toString()}`,
    signal,
  )
}

export function getEvent(projectId: string, eventId: string, signal?: AbortSignal) {
  return request<EventDetail>(
    `/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventId)}`,
    signal,
  )
}
