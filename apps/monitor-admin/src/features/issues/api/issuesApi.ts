import type { PaginationParams } from '@/shared/lib/pagination'
import { getJSON } from '@/shared/api/apiClient'
import type { TimeRange } from '@/features/time-range/model/timeRange'
import type { IssueDetailData, IssueListData } from '@/features/issues/model/issueTypes'

export function listIssues(
  projectId: string,
  range: TimeRange,
  pagination: PaginationParams,
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({
    page: String(pagination.page),
    pageSize: String(pagination.pageSize),
    from: String(range.from),
    to: String(range.to),
  })

  return getJSON<IssueListData>(
    `/projects/${encodeURIComponent(projectId)}/issues?${parameters.toString()}`,
    signal,
  )
}

export function getIssue(
  projectId: string,
  issueId: string,
  range: TimeRange,
  pagination: PaginationParams,
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({
    page: String(pagination.page),
    pageSize: String(pagination.pageSize),
    from: String(range.from),
    to: String(range.to),
  })

  return getJSON<IssueDetailData>(
    `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}?${parameters.toString()}`,
    signal,
  )
}
