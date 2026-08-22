import { queryOptions } from '@tanstack/react-query'
import { getProject, listProjects } from '@/features/projects/api/projectsApi'

export const projectsQueryKey = ['projects'] as const

export function projectDetailQueryKey(projectId: string) {
  return [...projectsQueryKey, projectId] as const
}

export function projectsQueryOptions() {
  return queryOptions({
    queryKey: projectsQueryKey,
    queryFn: ({ signal }) => listProjects(signal),
    staleTime: 30_000,
  })
}

export function projectDetailQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: projectDetailQueryKey(projectId),
    queryFn: ({ signal }) => getProject(projectId, signal),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  })
}
