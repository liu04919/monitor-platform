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
  if (query.isError) return <section className={styles.page}><Link className={styles.backLink} to="/events"><ArrowLeftIcon />返回事件流</Link><ErrorState message={eventErrorMessage(query.error)} onRetry={() => void query.refetch()} /></section>

  const event = query.data
  const replayData = parseReplayData(event.replayData)

  return (
    <section className={styles.page}>
      <Link className={styles.backLink} to="/events"><ArrowLeftIcon />返回事件流</Link>
      <div className={styles.heading}>
        <span className={`${styles.detailIcon} ${styles[event.category]}`}><AlertIcon /></span>
        <div>
          <div className={styles.badges}><EventCategoryBadge category={event.category} /><span className={styles.typeBadge}>{event.eventType}</span>{event.level ? <span className={styles.levelBadge}>{event.level}</span> : null}</div>
          <h1>{detailEventName(event)}</h1>
          {event.pageUrl ? <a href={event.pageUrl} target="_blank" rel="noreferrer">{event.pageUrl}<ExternalIcon /></a> : <span className={styles.missingUrl}>未记录页面地址</span>}
        </div>
      </div>
      <EventMetadata event={event} />
      <JsonPanel title="Payload" value={event.payload} />
      <div className={styles.columns}><BreadcrumbTimeline breadcrumbs={event.breadcrumbs} /><EventContext event={event} /></div>
      {replayData !== null ? <JsonPanel title="Replay Data" value={replayData} /> : null}
    </section>
  )
}
