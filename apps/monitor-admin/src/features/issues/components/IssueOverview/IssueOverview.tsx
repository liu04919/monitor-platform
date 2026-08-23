import { Button } from '@mantine/core'
import { Link } from 'react-router-dom'
import type { IssueSummary } from '@/features/issues/model/issueTypes'
import { formatFullTime } from '@/shared/lib/dateFormat'
import { ExternalIcon } from '@/shared/ui/icons/Icons'
import styles from './IssueOverview.module.css'

const numberFormatter = new Intl.NumberFormat('zh-CN')

interface IssueOverviewProps {
  issue: IssueSummary
}

export function IssueOverview({ issue }: IssueOverviewProps) {
  return (
    <section className={styles.card} aria-labelledby="issue-overview-title">
      <div className={styles.header}>
        <div>
          <p>ISSUE OVERVIEW</p>
          <h2 id="issue-overview-title">问题概览</h2>
        </div>
        <Button
          component={Link}
          to={`/events/${encodeURIComponent(issue.latestEventId)}`}
          variant="default"
          size="compact-sm"
        >
          查看最近事件
        </Button>
      </div>

      <dl className={styles.metrics}>
        <div>
          <dt>累计事件</dt>
          <dd>{numberFormatter.format(issue.eventCount)}</dd>
        </div>
        <div>
          <dt>影响用户</dt>
          <dd>{numberFormatter.format(issue.affectedUsers)}</dd>
        </div>
        <div>
          <dt>首次发生</dt>
          <dd>{formatFullTime(issue.firstSeen)}</dd>
        </div>
        <div>
          <dt>最近发生</dt>
          <dd>{formatFullTime(issue.lastSeen)}</dd>
        </div>
      </dl>

      <div className={styles.location}>
        <span>最近页面</span>
        {issue.latestPageUrl ? (
          <a href={issue.latestPageUrl} target="_blank" rel="noreferrer" title={issue.latestPageUrl}>
            {issue.latestPageUrl}
            <ExternalIcon />
          </a>
        ) : <strong>未记录页面地址</strong>}
      </div>
    </section>
  )
}
