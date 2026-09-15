import { Anchor, Badge, Button, Group, Tabs, ThemeIcon } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BreadcrumbTimeline } from '@/features/events/components/BreadcrumbTimeline/BreadcrumbTimeline'
import { EventCategoryBadge } from '@/features/events/components/EventCategoryBadge/EventCategoryBadge'
import { EventDetailSkeleton } from '@/features/events/components/EventDetailSkeleton/EventDetailSkeleton'
import {
  EventContext,
  EventMetadata,
} from '@/features/events/components/EventMetadata/EventMetadata'
import { JsonPanel } from '@/features/events/components/JsonPanel/JsonPanel'
import { ExceptionPanel } from '@/features/events/components/ExceptionPanel/ExceptionPanel'
import type { EventDetail } from '@/features/events/model/eventTypes'
import { detailEventName, eventErrorMessage } from '@/features/events/model/eventFormatters'
import { eventDetailQueryOptions } from '@/features/events/model/eventQueries'
import { ErrorState } from '@/shared/ui/feedback/AsyncFeedback'
import { AlertIcon, ArrowLeftIcon, ExternalIcon } from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import { ReplayPanel } from '@/features/replay/components/ReplayPanel'
import styles from './EventDetailPage.module.css'
import { listSearch } from '@/features/time-range/model/timeRange'

export function EventDetailPage() {
  const { eventId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const view = requestedView === 'raw' || requestedView === 'replay' ? requestedView : 'overview'
  const projectId = useAdminStore((state) => state.projectId)
  const query = useQuery(eventDetailQueryOptions(projectId, eventId))

  if (query.isPending)
    return (
      <section className={styles.page}>
        <EventDetailSkeleton />
      </section>
    )
  if (query.isError) {
    return (
      <section className={styles.page}>
        <BackToEvents />
        <ErrorState message={eventErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      </section>
    )
  }

  const event = query.data

  return (
    <section className={styles.page}>
      <BackToEvents />
      <div className={styles.heading}>
        <ThemeIcon
          className={styles.detailIcon}
          color={event.category === 'error' ? 'red' : 'blue'}
          variant="light"
          radius="xl"
        >
          <AlertIcon />
        </ThemeIcon>
        <div>
          <Group className={styles.badges} gap="xs">
            <EventCategoryBadge category={event.category} />
            <Badge variant="light" color="gray" size="sm" radius="sm">
              {event.eventType}
            </Badge>
            {event.level ? (
              <Badge variant="light" color="red" size="sm" radius="sm">
                {event.level}
              </Badge>
            ) : null}
          </Group>
          <h1>{detailEventName(event)}</h1>
          {event.pageUrl ? (
            <Anchor
              className={styles.pageUrl}
              href={event.pageUrl}
              target="_blank"
              rel="noreferrer"
            >
              {event.pageUrl}
              <ExternalIcon />
            </Anchor>
          ) : (
            <span className={styles.missingUrl}>未记录页面地址</span>
          )}
        </div>
      </div>
      <Tabs
        value={view}
        keepMounted={false}
        onChange={(nextView) => {
          const next = new URLSearchParams(searchParams)
          if (nextView === 'raw' || nextView === 'replay') next.set('view', nextView)
          else next.delete('view')
          setSearchParams(next)
        }}
      >
        <Tabs.List className={styles.tabs} aria-label="事件详情视图">
          <Tabs.Tab value="overview">概览</Tabs.Tab>
          <Tabs.Tab value="replay">录屏</Tabs.Tab>
          <Tabs.Tab value="raw">原始数据</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview">
          <div className={styles.columns}>
            <div className={styles.primary}>
              {event.category === 'error' ? (
                <ExceptionPanel payload={event.payload} />
              ) : (
                <JsonPanel title="Payload" value={event.payload} />
              )}
              <BreadcrumbTimeline breadcrumbs={event.breadcrumbs} />
            </div>
            <EventContext event={event} />
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="replay">
          <ReplayPanel
            key={event.eventId}
            replayData={event.replayData}
            timestamp={event.timestamp}
          />
        </Tabs.Panel>
        <Tabs.Panel value="raw">
          <RawEventData event={event} />
        </Tabs.Panel>
      </Tabs>
    </section>
  )
}

// 切换到原始数据时才格式化 JSON，避免录屏大字符串影响概览渲染。
function RawEventData({ event }: { event: EventDetail }) {
  return (
    <div className={styles.primary}>
      <EventMetadata event={event} />
      <JsonPanel title="Payload" value={event.payload} />
      {event.replayData ? <JsonPanel title="Replay Data" value={event.replayData} /> : null}
    </div>
  )
}

function BackToEvents() {
  const [params] = useSearchParams()
  const issueId = params.get('issueId')
  const fromIssue = issueId && /^[a-f0-9]{32}$/.test(issueId)
  return (
    <Button
      component={Link}
      className={styles.backLink}
      to={`${fromIssue ? `/issues/${issueId}` : '/events'}${listSearch(params)}`}
      variant="subtle"
      color="gray"
      size="compact-sm"
      leftSection={<ArrowLeftIcon />}
    >
      {fromIssue ? '返回问题详情' : '返回事件流'}
    </Button>
  )
}
