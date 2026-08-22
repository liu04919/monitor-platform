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

export interface IssueListData {
  issues: IssueSummary[]
  nextCursor: string
}
