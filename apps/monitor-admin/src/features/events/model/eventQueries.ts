import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { getEvent, listEvents } from '@/features/events/api/eventsApi'
import type { EventFilters } from '@/features/events/model/eventTypes'
import type { TimeRange } from '@/features/time-range/model/timeRange'

export function eventsQueryOptions(
  projectId: string,
  filters: EventFilters,
  range: TimeRange | null,
) {
  return infiniteQueryOptions({
    queryKey: ['projects', projectId, 'events', filters, range] as const,
    queryFn: ({ pageParam, signal }) => listEvents(projectId, filters, range!, pageParam, signal),
    enabled: Boolean(projectId && range),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  })
}

export function eventDetailQueryOptions(projectId: string, eventId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'events', eventId] as const,
    queryFn: ({ signal }) => getEvent(projectId, eventId, signal),
    enabled: Boolean(projectId && eventId),
  })
}
