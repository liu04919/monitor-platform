import { getJSON } from '@/shared/api/apiClient'
import type { EventDetail, EventFilters, EventListData } from '@/features/events/model/eventTypes'

export function listEvents(projectId: string, filters: EventFilters, cursor: string, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ limit: '30' })
  if (filters.category) parameters.set('category', filters.category)
  if (filters.eventType) parameters.set('eventType', filters.eventType)
  if (cursor) parameters.set('cursor', cursor)

  return getJSON<EventListData>(
    `/projects/${encodeURIComponent(projectId)}/events?${parameters.toString()}`,
    signal,
  )
}

export function getEvent(projectId: string, eventId: string, signal?: AbortSignal) {
  return getJSON<EventDetail>(
    `/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventId)}`,
    signal,
  )
}
