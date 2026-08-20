import { Anchor, Badge, Button, Group, ThemeIcon } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { BreadcrumbTimeline } from '@/features/events/components/BreadcrumbTimeline/BreadcrumbTimeline'
import { EventCategoryBadge } from '@/features/events/components/EventCategoryBadge/EventCategoryBadge'
import { EventDetailSkeleton } from '@/features/events/components/EventDetailSkeleton/EventDetailSkeleton'
import { EventContext, EventMetadata } from '@/features/events/components/EventMetadata/EventMetadata'
import { JsonPanel } from '@/features/events/components/JsonPanel/JsonPanel'
import { detailEventName, eventErrorMessage } from '@/features/events/model/eventFormatters'
import { eventDetailQueryOptions } from '@/features/events/model/eventQueries'
import { ErrorState } from '@/shared/ui/feedback/AsyncFeedback'
import { AlertIcon, ArrowLeftIcon, ExternalIcon } from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import styles from './EventDetailPage.module.css'

function parseReplayData(value: string | null) {
  if (!value) return null
  try { return JSON.parse(value) as unknown } catch { return value }
}

export function EventDetailPage() {
  const { eventId = '' } = useParams()
  const projectId = useAdminStore((state) => state.projectId)
  const query = useQuery(eventDetailQueryOptions(projectId, eventId))

  if (query.isPending) return <section className={styles.page}><EventDetailSkeleton /></section>
  if (query.isError) {
    return (
      <section className={styles.page}>
        <BackToEvents />
        <ErrorState message={eventErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      </section>
    )
  }

  const event = query.data
  const replayData = parseReplayData(event.replayData)

  return (
    <section className={styles.page}>
      <BackToEvents />
      <div className={styles.heading}>
        <ThemeIcon className={styles.detailIcon} color={event.category === 'error' ? 'red' : 'blue'} variant="light" radius="xl"><AlertIcon /></ThemeIcon>
        <div>
          <Group className={styles.badges} gap="xs">
            <EventCategoryBadge category={event.category} />
            <Badge variant="light" color="gray" size="sm" radius="sm">{event.eventType}</Badge>
            {event.level ? <Badge variant="light" color="red" size="sm" radius="sm">{event.level}</Badge> : null}
          </Group>
          <h1>{detailEventName(event)}</h1>
          {event.pageUrl ? (
            <Anchor className={styles.pageUrl} href={event.pageUrl} target="_blank" rel="noreferrer">
              {event.pageUrl}<ExternalIcon />
            </Anchor>
          ) : <span className={styles.missingUrl}>未记录页面地址</span>}
        </div>
      </div>
      <EventMetadata event={event} />
      <JsonPanel title="Payload" value={event.payload} />
      <div className={styles.columns}><BreadcrumbTimeline breadcrumbs={event.breadcrumbs} /><EventContext event={event} /></div>
      {replayData !== null ? <JsonPanel title="Replay Data" value={replayData} /> : null}
    </section>
  )
}

function BackToEvents() {
  return (
    <Button
      component={Link}
      className={styles.backLink}
      to="/events"
      variant="subtle"
      color="gray"
      size="compact-sm"
      leftSection={<ArrowLeftIcon />}
    >
      返回事件流
    </Button>
  )
}
