import { getJSON } from '@/shared/api/apiClient'
import type { TimeRange } from '@/features/time-range/model/timeRange'
import type { IssueDetailData, IssueListData } from '@/features/issues/model/issueTypes'

export function listIssues(
  projectId: string,
  range: TimeRange,
  cursor: string,
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({
    limit: '30',
    from: String(range.from),
    to: String(range.to),
  })
  if (cursor) parameters.set('cursor', cursor)

  return getJSON<IssueListData>(
    `/projects/${encodeURIComponent(projectId)}/issues?${parameters.toString()}`,
    signal,
  )
}

export function getIssue(
  projectId: string,
  issueId: string,
  range: TimeRange,
  cursor: string,
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({
    limit: '30',
    from: String(range.from),
    to: String(range.to),
  })
  if (cursor) parameters.set('cursor', cursor)

  return getJSON<IssueDetailData>(
    `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}?${parameters.toString()}`,
    signal,
  )
}
