import { Link } from 'react-router-dom'
import type { EventSummary } from '@/features/events/model/eventTypes'
import { displayEventName } from '@/features/events/model/eventFormatters'
import { formatTime } from '@/shared/lib/dateFormat'
import { AlertIcon, ChevronIcon } from '@/shared/ui/icons/Icons'
import { EventCategoryBadge } from '@/features/events/components/EventCategoryBadge/EventCategoryBadge'
import styles from './EventTable.module.css'

interface EventTableProps {
  events: EventSummary[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
}

export function EventTable({ events, hasNextPage, isFetchingNextPage, onLoadMore }: EventTableProps) {
  return (
    <>
      <div className={`${styles.row} ${styles.header}`} aria-hidden="true"><span>事件</span><span>分类</span><span>事件类型</span><span>用户</span><span>发生时间</span><span>传输</span></div>
      {events.map((event) => (
        <article className={`${styles.row} ${styles.item}`} key={event.eventId}>
          <div className={styles.identity}>
            <span className={`${styles.severity} ${styles[event.category]}`}><AlertIcon /></span>
            <div><Link to={`/events/${encodeURIComponent(event.eventId)}`}>{displayEventName(event)}</Link><span title={event.pageUrl}>{event.pageUrl || '未记录页面地址'}</span></div>
          </div>
          <div><EventCategoryBadge category={event.category} /></div>
          <code className={styles.eventType}>{event.eventType}</code>
          <span className={styles.mutedCell}>{event.userId || '匿名'}</span>
          <time dateTime={new Date(event.timestamp).toISOString()}>{formatTime(event.timestamp)}</time>
          <div className={styles.transportCell}><span className={`${styles.transport} ${styles[event.sendType]}`}>{event.sendType}</span><Link to={`/events/${encodeURIComponent(event.eventId)}`} aria-label={`查看 ${displayEventName(event)} 详情`}><ChevronIcon /></Link></div>
        </article>
      ))}
      <footer className={styles.footer}>
        <span>已加载 <strong>{events.length}</strong> 条事件</span>
        {hasNextPage ? <button type="button" onClick={onLoadMore} disabled={isFetchingNextPage}>{isFetchingNextPage ? '加载中…' : '加载更多'}<ChevronIcon /></button> : <span>已经到底了</span>}
      </footer>
    </>
  )
}
