import { queryOptions } from '@tanstack/react-query'
import { listProjects } from '@/features/projects/api/projectsApi'

export const projectsQueryKey = ['projects'] as const

export function projectsQueryOptions() {
  return queryOptions({
    queryKey: projectsQueryKey,
    queryFn: ({ signal }) => listProjects(signal),
    staleTime: 30_000,
  })
}
