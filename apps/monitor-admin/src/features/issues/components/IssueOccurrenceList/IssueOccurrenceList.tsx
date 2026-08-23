import { Badge, Button } from '@mantine/core'
import { Link } from 'react-router-dom'
import type { IssueOccurrence } from '@/features/issues/model/issueTypes'
import { formatFullTime } from '@/shared/lib/dateFormat'
import { ChevronIcon } from '@/shared/ui/icons/Icons'
import styles from './IssueOccurrenceList.module.css'

interface IssueOccurrenceListProps {
  occurrences: IssueOccurrence[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
}

export function IssueOccurrenceList({
  occurrences,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: IssueOccurrenceListProps) {
  return (
    <section className={styles.panel} aria-labelledby="occurrence-list-title">
      <header className={styles.heading}>
        <div>
          <p>OCCURRENCES</p>
          <h2 id="occurrence-list-title">发生记录</h2>
        </div>
        <span>已加载 {occurrences.length} 条</span>
      </header>

      <div className={`${styles.row} ${styles.columns}`} aria-hidden="true">
        <span>事件</span>
        <span>用户</span>
        <span>发生时间</span>
        <span />
      </div>

      {occurrences.map((occurrence) => (
        <article className={`${styles.row} ${styles.occurrence}`} key={occurrence.eventId}>
          <div className={styles.identity}>
            <Link to={`/events/${encodeURIComponent(occurrence.eventId)}`}>
              {occurrence.message || occurrence.eventType}
            </Link>
            <div>
              <Badge color="red" variant="light" size="xs">{occurrence.eventType}</Badge>
              <span title={occurrence.pageUrl}>{occurrence.pageUrl || '未记录页面地址'}</span>
            </div>
          </div>
          <code>{occurrence.userId || '匿名用户'}</code>
          <time dateTime={new Date(occurrence.timestamp).toISOString()}>
            {formatFullTime(occurrence.timestamp)}
          </time>
          <Link
            className={styles.detailLink}
            to={`/events/${encodeURIComponent(occurrence.eventId)}`}
            aria-label={`查看事件 ${occurrence.eventId}`}
          >
            <ChevronIcon />
          </Link>
        </article>
      ))}

      <footer className={styles.footer}>
        {hasNextPage ? (
          <Button
            variant="default"
            size="compact-sm"
            type="button"
            onClick={onLoadMore}
            loading={isFetchingNextPage}
            rightSection={<ChevronIcon />}
          >
            加载更多发生记录
          </Button>
        ) : <span>已经加载全部发生记录</span>}
      </footer>
    </section>
  )
}
