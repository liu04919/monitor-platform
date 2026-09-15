import type { PaginationParams } from '@/shared/lib/pagination'
import { getJSON } from '@/shared/api/apiClient'
import type { TimeRange } from '@/features/time-range/model/timeRange'
import type { EventDetail, EventFilters, EventListData } from '@/features/events/model/eventTypes'

export function listEvents(
  projectId: string,
  filters: EventFilters,
  range: TimeRange,
  pagination: PaginationParams,
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({
    page: String(pagination.page),
    pageSize: String(pagination.pageSize),
    from: String(range.from),
    to: String(range.to),
  })
  if (filters.category) parameters.set('category', filters.category)
  if (filters.eventType) parameters.set('eventType', filters.eventType)

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
