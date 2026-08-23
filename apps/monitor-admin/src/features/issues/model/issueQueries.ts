import { infiniteQueryOptions } from '@tanstack/react-query'
import { getIssue, listIssues } from '@/features/issues/api/issuesApi'

export function issuesQueryOptions(projectId: string) {
  return infiniteQueryOptions({
    queryKey: ['projects', projectId, 'issues'] as const,
    queryFn: ({ pageParam, signal }) => listIssues(projectId, pageParam, signal),
    enabled: Boolean(projectId),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  })
}

export function issueDetailQueryOptions(projectId: string, issueId: string) {
  return infiniteQueryOptions({
    queryKey: ['projects', projectId, 'issues', issueId] as const,
    queryFn: ({ pageParam, signal }) => getIssue(projectId, issueId, pageParam, signal),
    enabled: Boolean(projectId && issueId),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  })
}
