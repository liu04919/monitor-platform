import { Badge, Button } from '@mantine/core'
import { Link } from 'react-router-dom'
import type { IssueSummary } from '@/features/issues/model/issueTypes'
import { formatTime } from '@/shared/lib/dateFormat'
import { AlertIcon, ChevronIcon } from '@/shared/ui/icons/Icons'
import styles from './IssueTable.module.css'

const numberFormatter = new Intl.NumberFormat('zh-CN')

interface IssueTableProps {
  issues: IssueSummary[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
}

export function IssueTable({
  issues,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: IssueTableProps) {
  return (
    <>
      <div className={`${styles.row} ${styles.header}`} aria-hidden="true">
        <span>问题</span>
        <span>事件数</span>
        <span>影响用户</span>
        <span>首次发生</span>
        <span>最近发生</span>
        <span />
      </div>
      {issues.map((issue) => (
        <article className={`${styles.row} ${styles.item}`} key={issue.id}>
          <div className={styles.identity}>
            <span className={styles.severity}><AlertIcon /></span>
            <div>
              <Link to={`/events/${encodeURIComponent(issue.latestEventId)}`}>{issue.title}</Link>
              <div className={styles.tags}>
                {issue.exceptionType ? <Badge color="red" variant="light" size="xs">{issue.exceptionType}</Badge> : null}
                <code>{issue.eventType}</code>
              </div>
              <span title={issue.latestPageUrl}>{issue.latestPageUrl || '未记录页面地址'}</span>
            </div>
          </div>
          <strong className={styles.count}>{numberFormatter.format(issue.eventCount)}</strong>
          <span className={styles.users}>{numberFormatter.format(issue.affectedUsers)}</span>
          <time dateTime={new Date(issue.firstSeen).toISOString()}>{formatTime(issue.firstSeen)}</time>
          <time dateTime={new Date(issue.lastSeen).toISOString()}>{formatTime(issue.lastSeen)}</time>
          <Link
            className={styles.latestLink}
            to={`/events/${encodeURIComponent(issue.latestEventId)}`}
            aria-label={`查看 ${issue.title} 的最近事件`}
          >
            <ChevronIcon />
          </Link>
        </article>
      ))}
      <footer className={styles.footer}>
        <span>已加载 <strong>{issues.length}</strong> 个问题</span>
        {hasNextPage ? (
          <Button
            variant="default"
            size="compact-sm"
            type="button"
            onClick={onLoadMore}
            loading={isFetchingNextPage}
            rightSection={<ChevronIcon />}
          >
            加载更多
          </Button>
        ) : <span>已经到底了</span>}
      </footer>
    </>
  )
}
