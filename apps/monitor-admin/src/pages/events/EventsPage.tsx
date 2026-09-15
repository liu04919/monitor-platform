import { useMemo } from 'react'
import { ActionIcon, Group } from '@mantine/core'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { EventFilters } from '@/features/events/components/EventFilters/EventFilters'
import { EventTable } from '@/features/events/components/EventTable/EventTable'
import { eventErrorMessage } from '@/features/events/model/eventFormatters'
import { eventsQueryOptions } from '@/features/events/model/eventQueries'
import type { EventCategory, EventFilters as Filters } from '@/features/events/model/eventTypes'
import {
  ErrorState,
  EmptyState,
  InlineError,
  LoadingRows,
} from '@/shared/ui/feedback/AsyncFeedback'
import { RefreshIcon } from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import styles from './EventsPage.module.css'
import { TimeRangePicker } from '@/features/time-range/components/TimeRangePicker'
import { useTimeRange } from '@/features/time-range/model/useTimeRange'
import { presetTimeRange } from '@/features/time-range/model/timeRange'

const supportedCategories = new Set<EventCategory>([
  'error',
  'performance',
  'behavior',
  'stability',
  'ai',
])

export function EventsPage() {
  const projectId = useAdminStore((state) => state.projectId)
  const [searchParams, setSearchParams] = useSearchParams()
  const categoryValue = searchParams.get('category') || ''
  const eventType = searchParams.get('eventType')?.trim() || ''
  const category = supportedCategories.has(categoryValue as EventCategory)
    ? (categoryValue as EventCategory)
    : ''
  const filters = useMemo<Filters>(() => ({ category, eventType }), [category, eventType])
  const { range, setRange, refresh } = useTimeRange()
  const query = useInfiniteQuery(eventsQueryOptions(projectId, filters, range))
  const events = query.data?.pages.flatMap((page) => page.events) || []
  const hasFilters = Boolean(category || eventType)

  const applyFilters = (nextFilters: Filters) => {
    const next = new URLSearchParams(searchParams)
    next.delete('category')
    next.delete('eventType')
    next.delete('cursor')
    if (nextFilters.category) next.set('category', nextFilters.category)
    if (nextFilters.eventType) next.set('eventType', nextFilters.eventType)
    setSearchParams(next)
  }

  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>事件流</h1>
        </div>
        <Group gap="xs">
          <TimeRangePicker value={range} onChange={setRange} />
          <ActionIcon
            className={styles.refreshButton}
            variant="default"
            size={38}
            onClick={() => refresh(query.refetch)}
            disabled={!range}
            loading={query.isFetching}
            aria-label="刷新事件"
          >
            <RefreshIcon />
          </ActionIcon>
        </Group>
      </div>

      <EventFilters key={`${category}:${eventType}`} value={filters} onApply={applyFilters} />

      <div className={styles.panel}>
        {!range ? (
          <ErrorState
            message="时间范围无效，请重新选择"
            onRetry={() => setRange(presetTimeRange('24h'))}
          />
        ) : null}
        {range && query.isPending ? <LoadingRows /> : null}
        {query.isError && events.length === 0 ? (
          <ErrorState
            message={eventErrorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {!query.isPending && !query.isError && events.length === 0 ? (
          <EmptyState filtered={hasFilters} />
        ) : null}
        {events.length > 0 ? (
          <EventTable
            events={events}
            hasNextPage={query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            onLoadMore={() => void query.fetchNextPage()}
          />
        ) : null}
      </div>
      {query.isFetchNextPageError ? (
        <InlineError
          message={eventErrorMessage(query.error)}
          onRetry={() => void query.fetchNextPage()}
        />
      ) : null}
    </section>
  )
}
