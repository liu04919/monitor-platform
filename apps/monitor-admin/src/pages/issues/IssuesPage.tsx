import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core'
import { useInfiniteQuery } from '@tanstack/react-query'
import { IssueTable } from '@/features/issues/components/IssueTable/IssueTable'
import { issuesQueryOptions } from '@/features/issues/model/issueQueries'
import { issueErrorMessage } from '@/features/issues/model/issueFormatters'
import { AlertIcon, EmptyIcon, RefreshIcon } from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import styles from './IssuesPage.module.css'
import { TimeRangePicker } from '@/features/time-range/components/TimeRangePicker'
import { useTimeRange } from '@/features/time-range/model/useTimeRange'
import { presetTimeRange } from '@/features/time-range/model/timeRange'
import { ErrorState, InlineError } from '@/shared/ui/feedback/AsyncFeedback'

const loadingRows = Array.from({ length: 5 }, (_, index) => index)

export function IssuesPage() {
  const projectId = useAdminStore((state) => state.projectId)
  const { range, setRange, refresh } = useTimeRange()
  const query = useInfiniteQuery(issuesQueryOptions(projectId, range))
  const issues = query.data?.pages.flatMap((page) => page.issues) || []

  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>问题</h1>
        </div>
        <Group gap="xs">
          <TimeRangePicker value={range} onChange={setRange} />
          <ActionIcon
            className={styles.refreshButton}
            variant="default"
            size={38}
            onClick={() => refresh(query.refetch)}
            disabled={!range}
            loading={query.isFetching}
            aria-label="刷新问题"
          >
            <RefreshIcon />
          </ActionIcon>
        </Group>
      </div>

      <div className={styles.panel}>
        {!range ? (
          <ErrorState
            message="时间范围无效，请重新选择"
            onRetry={() => setRange(presetTimeRange('24h'))}
          />
        ) : null}
        {range && query.isPending ? (
          <div aria-label="正在读取问题">
            {loadingRows.map((row) => (
              <Skeleton className={styles.loadingRow} key={row} />
            ))}
          </div>
        ) : null}
        {query.isError && issues.length === 0 ? (
          <Alert
            className={styles.error}
            color="red"
            title="问题读取失败"
            icon={<AlertIcon />}
            role="alert"
          >
            <Text size="sm">{issueErrorMessage(query.error)}</Text>
            <Button
              variant="default"
              size="compact-sm"
              mt="sm"
              onClick={() => void query.refetch()}
            >
              重新加载
            </Button>
          </Alert>
        ) : null}
        {!query.isPending && !query.isError && issues.length === 0 ? (
          <Stack className={styles.empty} align="center" justify="center" gap="xs">
            <ThemeIcon variant="light" color="gray" size={52} radius="md">
              <EmptyIcon />
            </ThemeIcon>
            <Title order={2}>所选时段暂无问题</Title>
          </Stack>
        ) : null}
        {issues.length > 0 ? (
          <IssueTable
            issues={issues}
            hasNextPage={query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            onLoadMore={() => void query.fetchNextPage()}
          />
        ) : null}
      </div>
      {query.isFetchNextPageError ? (
        <InlineError
          message={issueErrorMessage(query.error)}
          onRetry={() => void query.fetchNextPage()}
        />
      ) : null}
    </section>
  )
}
