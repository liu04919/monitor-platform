import { infiniteQueryOptions } from '@tanstack/react-query'
import { getIssue, listIssues } from '@/features/issues/api/issuesApi'
import type { TimeRange } from '@/features/time-range/model/timeRange'

export function issuesQueryOptions(projectId: string, range: TimeRange | null) {
  return infiniteQueryOptions({
    queryKey: ['projects', projectId, 'issues', range] as const,
    queryFn: ({ pageParam, signal }) => listIssues(projectId, range!, pageParam, signal),
    enabled: Boolean(projectId && range),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  })
}

export function issueDetailQueryOptions(
  projectId: string,
  issueId: string,
  range: TimeRange | null,
) {
  return infiniteQueryOptions({
    queryKey: ['projects', projectId, 'issues', issueId, range] as const,
    queryFn: ({ pageParam, signal }) => getIssue(projectId, issueId, range!, pageParam, signal),
    enabled: Boolean(projectId && issueId && range),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  })
}
