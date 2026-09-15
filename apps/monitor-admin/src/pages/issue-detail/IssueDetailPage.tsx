import { usePagination } from '@/shared/hooks/usePagination'
import { EmptyPage, PaginationFooter } from '@/shared/ui/pagination/PaginationFooter'
import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import { APIError } from '@/shared/api/apiClient'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { IssueDetailSkeleton } from '@/features/issues/components/IssueDetailSkeleton/IssueDetailSkeleton'
import { IssueOccurrenceList } from '@/features/issues/components/IssueOccurrenceList/IssueOccurrenceList'
import { IssueOverview } from '@/features/issues/components/IssueOverview/IssueOverview'
import { issueErrorMessage } from '@/features/issues/model/issueFormatters'
import { issueDetailQueryOptions } from '@/features/issues/model/issueQueries'
import { ErrorState, InlineError } from '@/shared/ui/feedback/AsyncFeedback'
import { AlertIcon, ArrowLeftIcon, RefreshIcon } from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import styles from './IssueDetailPage.module.css'
import { TimeRangePicker } from '@/features/time-range/components/TimeRangePicker'
import { useTimeRange } from '@/features/time-range/model/useTimeRange'
import { listSearch, presetTimeRange } from '@/features/time-range/model/timeRange'

export function IssueDetailPage() {
  const { issueId = '' } = useParams()
  const projectId = useAdminStore((state) => state.projectId)
  const { range, setRange, refresh } = useTimeRange()
  const { pagination, setPagination } = usePagination()
  const query = useQuery(issueDetailQueryOptions(projectId, issueId, range, pagination))
  const toolbar = (
    <Group justify="space-between" mb="lg">
      <BackToIssues />
      <Group gap="xs">
        <TimeRangePicker value={range} onChange={setRange} />
        <ActionIcon
          variant="default"
          size={38}
          aria-label="刷新发生记录"
          disabled={!range}
          loading={query.isFetching}
          onClick={() => refresh(query.refetch)}
        >
          <RefreshIcon />
        </ActionIcon>
      </Group>
    </Group>
  )

  if (!range)
    return (
      <section className={styles.page}>
        {toolbar}
        <ErrorState
          message="时间范围无效，请重新选择"
          onRetry={() => setRange(presetTimeRange('24h'))}
        />
      </section>
    )

  if (query.isPending) {
    return (
      <section className={styles.page}>
        {toolbar}
        <IssueDetailSkeleton />
      </section>
    )
  }
  if (query.isError && !query.data) {
    if (query.error instanceof APIError && query.error.code === 'ISSUE_NOT_FOUND') {
      return (
        <section className={styles.page}>
          {toolbar}
          <Paper withBorder>
            <Stack align="center" justify="center" mih={280}>
              <Text c="dimmed">所选时段暂无发生记录</Text>
            </Stack>
          </Paper>
        </section>
      )
    }
    return (
      <section className={styles.page}>
        {toolbar}
        <ErrorState message={issueErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      </section>
    )
  }

  const issue = query.data.issue
  const occurrences = query.data.occurrences

  return (
    <section className={styles.page}>
      {toolbar}
      <div className={styles.heading}>
        <ThemeIcon className={styles.issueIcon} color="red" variant="light" radius="xl">
          <AlertIcon />
        </ThemeIcon>
        <div>
          <Group className={styles.badges} gap="xs">
            <Badge color="red" variant="light" size="sm">
              错误问题
            </Badge>
            {issue.exceptionType ? (
              <Badge color="grape" variant="light" size="sm">
                {issue.exceptionType}
              </Badge>
            ) : null}
            <Badge color="gray" variant="light" size="sm">
              {issue.eventType}
            </Badge>
          </Group>
          <h1>{issue.title}</h1>
          <code title={issue.id}>{issue.id}</code>
        </div>
      </div>

      <div className={styles.content}>
        <IssueOverview issue={issue} />
        <div className={styles.occurrences}>
          <IssueOccurrenceList occurrences={occurrences} />
          {occurrences.length === 0 ? (
            <EmptyPage onFirstPage={() => setPagination({ ...pagination, page: 1 })} />
          ) : null}
          <PaginationFooter
            info={query.data}
            disabled={query.isFetching}
            onChange={setPagination}
          />
        </div>
        {query.isError && query.data ? (
          <InlineError
            message={issueErrorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : null}
      </div>
    </section>
  )
}

function BackToIssues() {
  const [params] = useSearchParams()
  const listParams = new URLSearchParams(listSearch(params))
  listParams.set('page', params.get('issuesPage') || '1')
  if (params.has('issuesPageSize')) listParams.set('pageSize', params.get('issuesPageSize')!)
  listParams.delete('issuesPage')
  listParams.delete('issuesPageSize')
  return (
    <Button
      component={Link}
      className={styles.backLink}
      to={`/issues?${listParams}`}
      variant="subtle"
      color="gray"
      size="compact-sm"
      leftSection={<ArrowLeftIcon />}
    >
      返回问题列表
    </Button>
  )
}
