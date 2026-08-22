import { getJSON } from '@/shared/api/apiClient'
import type { IssueListData } from '@/features/issues/model/issueTypes'

export function listIssues(projectId: string, cursor: string, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ limit: '30' })
  if (cursor) parameters.set('cursor', cursor)

  return getJSON<IssueListData>(
    `/projects/${encodeURIComponent(projectId)}/issues?${parameters.toString()}`,
    signal,
  )
}
