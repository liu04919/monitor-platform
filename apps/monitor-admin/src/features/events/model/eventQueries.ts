import type { PaginationParams } from '@/shared/lib/pagination'
import { queryOptions } from '@tanstack/react-query'
import { getEvent, listEvents } from '@/features/events/api/eventsApi'
import type { EventFilters } from '@/features/events/model/eventTypes'
import type { TimeRange } from '@/features/time-range/model/timeRange'

export function eventsQueryOptions(
  projectId: string,
  filters: EventFilters,
  range: TimeRange | null,
  pagination: PaginationParams,
) {
  return queryOptions({
    queryKey: ['projects', projectId, 'events', filters, range, pagination] as const,
    queryFn: ({ signal }) => listEvents(projectId, filters, range!, pagination, signal),
    enabled: Boolean(projectId && range),
  })
}

export function eventDetailQueryOptions(projectId: string, eventId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'events', eventId] as const,
    queryFn: ({ signal }) => getEvent(projectId, eventId, signal),
    enabled: Boolean(projectId && eventId),
  })
}
