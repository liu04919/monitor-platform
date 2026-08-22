import { infiniteQueryOptions } from '@tanstack/react-query'
import { listIssues } from '@/features/issues/api/issuesApi'

export function issuesQueryOptions(projectId: string) {
  return infiniteQueryOptions({
    queryKey: ['projects', projectId, 'issues'] as const,
    queryFn: ({ pageParam, signal }) => listIssues(projectId, pageParam, signal),
    enabled: Boolean(projectId),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  })
}
