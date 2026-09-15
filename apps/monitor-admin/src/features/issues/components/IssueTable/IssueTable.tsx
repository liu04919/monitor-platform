import { Badge } from '@mantine/core'
import { Link, useSearchParams } from 'react-router-dom'
import { listSearch } from '@/features/time-range/model/timeRange'
import type { IssueSummary } from '@/features/issues/model/issueTypes'
import { formatTime } from '@/shared/lib/dateFormat'
import { AlertIcon, ChevronIcon } from '@/shared/ui/icons/Icons'
import styles from './IssueTable.module.css'

const numberFormatter = new Intl.NumberFormat('zh-CN')

interface IssueTableProps {
  issues: IssueSummary[]
}

export function IssueTable({ issues }: IssueTableProps) {
  const [params] = useSearchParams()
  const detailParams = new URLSearchParams(listSearch(params))
  detailParams.set('issuesPage', params.get('page') || '1')
  detailParams.set('issuesPageSize', params.get('pageSize') || '30')
  detailParams.delete('page')
  const search = `?${detailParams}`
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
            <span className={styles.severity}>
              <AlertIcon />
            </span>
            <div>
              <Link to={`/issues/${encodeURIComponent(issue.id)}${search}`} title={issue.title}>
                {issue.title}
              </Link>
              <div className={styles.tags}>
                {issue.exceptionType ? (
                  <Badge color="red" variant="light" size="xs">
                    {issue.exceptionType}
                  </Badge>
                ) : null}
                <code>{issue.eventType}</code>
              </div>
              <span title={issue.latestPageUrl}>{issue.latestPageUrl || '未记录页面地址'}</span>
            </div>
          </div>
          <strong className={styles.count}>{numberFormatter.format(issue.eventCount)}</strong>
          <span className={styles.users}>{numberFormatter.format(issue.affectedUsers)}</span>
          <time dateTime={new Date(issue.firstSeen).toISOString()}>
            {formatTime(issue.firstSeen)}
          </time>
          <time dateTime={new Date(issue.lastSeen).toISOString()}>
            {formatTime(issue.lastSeen)}
          </time>
          <Link
            className={styles.latestLink}
            to={`/issues/${encodeURIComponent(issue.id)}${search}`}
            aria-label={`查看问题 ${issue.title}`}
          >
            <ChevronIcon />
          </Link>
        </article>
      ))}
    </>
  )
}
