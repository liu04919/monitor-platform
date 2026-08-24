import { ActionIcon, Alert, Button, Skeleton, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { useInfiniteQuery } from '@tanstack/react-query'
import { IssueTable } from '@/features/issues/components/IssueTable/IssueTable'
import { issuesQueryOptions } from '@/features/issues/model/issueQueries'
import { issueErrorMessage } from '@/features/issues/model/issueFormatters'
import { AlertIcon, EmptyIcon, RefreshIcon } from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import styles from './IssuesPage.module.css'

const loadingRows = Array.from({ length: 5 }, (_, index) => index)

export function IssuesPage() {
  const projectId = useAdminStore((state) => state.projectId)
  const query = useInfiniteQuery(issuesQueryOptions(projectId))
  const issues = query.data?.pages.flatMap((page) => page.issues) || []

  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>问题</h1>
        </div>
        <ActionIcon
          className={styles.refreshButton}
          variant="default"
          size={38}
          onClick={() => void query.refetch()}
          loading={query.isFetching}
          aria-label="刷新问题"
        >
          <RefreshIcon />
        </ActionIcon>
      </div>

      <div className={styles.panel}>
        {query.isPending ? (
          <div aria-label="正在读取问题">
            {loadingRows.map((row) => <Skeleton className={styles.loadingRow} key={row} />)}
          </div>
        ) : null}
        {query.isError && issues.length === 0 ? (
          <Alert className={styles.error} color="red" title="问题读取失败" icon={<AlertIcon />} role="alert">
            <Text size="sm">{issueErrorMessage(query.error)}</Text>
            <Button variant="default" size="compact-sm" mt="sm" onClick={() => void query.refetch()}>重新加载</Button>
          </Alert>
        ) : null}
        {!query.isPending && !query.isError && issues.length === 0 ? (
          <Stack className={styles.empty} align="center" justify="center" gap="xs">
            <ThemeIcon variant="light" color="gray" size={52} radius="md"><EmptyIcon /></ThemeIcon>
            <Title order={2}>暂无问题</Title>
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
    </section>
  )
}
