import { Badge, Button, Group, ThemeIcon } from '@mantine/core'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { IssueDetailSkeleton } from '@/features/issues/components/IssueDetailSkeleton/IssueDetailSkeleton'
import { IssueOccurrenceList } from '@/features/issues/components/IssueOccurrenceList/IssueOccurrenceList'
import { IssueOverview } from '@/features/issues/components/IssueOverview/IssueOverview'
import { issueErrorMessage } from '@/features/issues/model/issueFormatters'
import { issueDetailQueryOptions } from '@/features/issues/model/issueQueries'
import { ErrorState } from '@/shared/ui/feedback/AsyncFeedback'
import { AlertIcon, ArrowLeftIcon } from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import styles from './IssueDetailPage.module.css'

export function IssueDetailPage() {
  const { issueId = '' } = useParams()
  const projectId = useAdminStore((state) => state.projectId)
  const query = useInfiniteQuery(issueDetailQueryOptions(projectId, issueId))

  if (query.isPending) {
    return <section className={styles.page}><IssueDetailSkeleton /></section>
  }
  if (query.isError) {
    return (
      <section className={styles.page}>
        <BackToIssues />
        <ErrorState message={issueErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      </section>
    )
  }

  const issue = query.data.pages[0].issue
  const occurrences = query.data.pages.flatMap((page) => page.occurrences)

  return (
    <section className={styles.page}>
      <BackToIssues />
      <div className={styles.heading}>
        <ThemeIcon className={styles.issueIcon} color="red" variant="light" radius="xl">
          <AlertIcon />
        </ThemeIcon>
        <div>
          <Group className={styles.badges} gap="xs">
            <Badge color="red" variant="light" size="sm">错误问题</Badge>
            {issue.exceptionType ? <Badge color="grape" variant="light" size="sm">{issue.exceptionType}</Badge> : null}
            <Badge color="gray" variant="light" size="sm">{issue.eventType}</Badge>
          </Group>
          <h1>{issue.title}</h1>
          <code title={issue.id}>{issue.id}</code>
        </div>
      </div>

      <div className={styles.content}>
        <IssueOverview issue={issue} />
        <IssueOccurrenceList
          occurrences={occurrences}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
        />
      </div>
    </section>
  )
}

function BackToIssues() {
  return (
    <Button
      component={Link}
      className={styles.backLink}
      to="/issues"
      variant="subtle"
      color="gray"
      size="compact-sm"
      leftSection={<ArrowLeftIcon />}
    >
      返回问题列表
    </Button>
  )
}
