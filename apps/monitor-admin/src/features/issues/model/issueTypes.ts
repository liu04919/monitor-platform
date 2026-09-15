import type { PageInfo } from '@/shared/lib/pagination'

export interface IssueSummary {
  id: string
  title: string
  eventType: string
  exceptionType: string
  eventCount: number
  affectedUsers: number
  firstSeen: number
  lastSeen: number
  latestEventId: string
  latestPageUrl: string
}

export interface IssueListData extends PageInfo {
  issues: IssueSummary[]
}

export interface IssueOccurrence {
  eventId: string
  eventType: string
  timestamp: number
  pageUrl: string
  userId: string | null
  message: string
  receivedAt: number
}

export interface IssueDetailData extends PageInfo {
  issue: IssueSummary
  occurrences: IssueOccurrence[]
}
