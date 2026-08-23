import { getJSON } from '@/shared/api/apiClient'
import type { IssueDetailData, IssueListData } from '@/features/issues/model/issueTypes'

export function listIssues(projectId: string, cursor: string, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ limit: '30' })
  if (cursor) parameters.set('cursor', cursor)

  return getJSON<IssueListData>(
    `/projects/${encodeURIComponent(projectId)}/issues?${parameters.toString()}`,
    signal,
  )
}

export function getIssue(projectId: string, issueId: string, cursor: string, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ limit: '30' })
  if (cursor) parameters.set('cursor', cursor)

  return getJSON<IssueDetailData>(
    `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}?${parameters.toString()}`,
    signal,
  )
}
