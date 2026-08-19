import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { getEvent, listEvents } from '@/features/events/api/eventsApi'
import type { EventFilters } from '@/features/events/model/eventTypes'

export function eventsQueryOptions(projectId: string, filters: EventFilters) {
  return infiniteQueryOptions({
    queryKey: ['projects', projectId, 'events', filters] as const,
    queryFn: ({ pageParam, signal }) => listEvents(projectId, filters, pageParam, signal),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  })
}

export function eventDetailQueryOptions(projectId: string, eventId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'events', eventId] as const,
    queryFn: ({ signal }) => getEvent(projectId, eventId, signal),
    enabled: Boolean(eventId),
  })
}
