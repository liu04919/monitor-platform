import { queryOptions } from '@tanstack/react-query'
import { listProjects } from '@/features/projects/api/projectsApi'

export function projectsQueryOptions() {
  return queryOptions({
    queryKey: ['projects'] as const,
    queryFn: ({ signal }) => listProjects(signal),
    staleTime: 30_000,
  })
}
