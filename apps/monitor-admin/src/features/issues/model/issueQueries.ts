import type { PaginationParams } from '@/shared/lib/pagination'
import { queryOptions } from '@tanstack/react-query'
import { getIssue, listIssues } from '@/features/issues/api/issuesApi'
import type { TimeRange } from '@/features/time-range/model/timeRange'

export function issuesQueryOptions(
  projectId: string,
  range: TimeRange | null,
  pagination: PaginationParams,
) {
  return queryOptions({
    queryKey: ['projects', projectId, 'issues', range, pagination] as const,
    queryFn: ({ signal }) => listIssues(projectId, range!, pagination, signal),
    enabled: Boolean(projectId && range),
  })
}

export function issueDetailQueryOptions(
  projectId: string,
  issueId: string,
  range: TimeRange | null,
  pagination: PaginationParams,
) {
  return queryOptions({
    queryKey: ['projects', projectId, 'issues', issueId, range, pagination] as const,
    queryFn: ({ signal }) => getIssue(projectId, issueId, range!, pagination, signal),
    enabled: Boolean(projectId && issueId && range),
  })
}
