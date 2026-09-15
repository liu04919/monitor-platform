import { ActionIcon, Badge } from '@mantine/core'
import { Link, useSearchParams } from 'react-router-dom'
import { listSearch } from '@/features/time-range/model/timeRange'
import type { EventSummary } from '@/features/events/model/eventTypes'
import { displayEventName } from '@/features/events/model/eventFormatters'
import { formatTime } from '@/shared/lib/dateFormat'
import { AlertIcon, ChevronIcon } from '@/shared/ui/icons/Icons'
import { EventCategoryBadge } from '@/features/events/components/EventCategoryBadge/EventCategoryBadge'
import styles from './EventTable.module.css'

interface EventTableProps {
  events: EventSummary[]
}

export function EventTable({ events }: EventTableProps) {
  const [params] = useSearchParams()
  const search = listSearch(params)
  return (
    <>
      <div className={`${styles.row} ${styles.header}`} aria-hidden="true">
        <span>事件</span>
        <span>分类</span>
        <span>用户</span>
        <span>发生时间</span>
        <span>传输</span>
      </div>
      {events.map((event) => (
        <article className={`${styles.row} ${styles.item}`} key={event.eventId}>
          <div className={styles.identity}>
            <span className={`${styles.severity} ${styles[event.category]}`}>
              <AlertIcon />
            </span>
            <div>
              <Link
                to={`/events/${encodeURIComponent(event.eventId)}${search}`}
                title={displayEventName(event)}
              >
                {displayEventName(event)}
              </Link>
              <div className={styles.secondary}>
                <code className={styles.eventType}>{event.eventType}</code>
                <span title={event.pageUrl}>{event.pageUrl || '未记录页面地址'}</span>
              </div>
            </div>
          </div>
          <div>
            <EventCategoryBadge category={event.category} />
          </div>
          <span className={styles.mutedCell}>{event.userId || '匿名'}</span>
          <time dateTime={new Date(event.timestamp).toISOString()}>
            {formatTime(event.timestamp)}
          </time>
          <div className={styles.transportCell}>
            <Badge
              color={event.sendType === 'beacon' ? 'violet' : 'gray'}
              variant="light"
              size="xs"
            >
              {event.sendType}
            </Badge>
            <ActionIcon
              component={Link}
              to={`/events/${encodeURIComponent(event.eventId)}${search}`}
              variant="subtle"
              color="gray"
              aria-label={`查看 ${displayEventName(event)} 详情`}
            >
              <ChevronIcon />
            </ActionIcon>
          </div>
        </article>
      ))}
    </>
  )
}
