export type EventCategory = 'error' | 'performance' | 'behavior' | 'stability' | 'ai'
export type SendType = 'fetch' | 'beacon'
export type EventLevel = 'error' | 'warning'

export interface EventSummary {
  batchId: string
  sendType: SendType
  eventId: string
  category: EventCategory
  eventType: string
  timestamp: number
  pageUrl: string
  userId: string | null
  level: EventLevel | null
  message: string
  receivedAt: number
}

export interface Breadcrumb {
  timestamp: number
  category: 'click' | 'navigation' | 'http' | 'console' | 'custom'
  message: string | null
  data: unknown
}

export interface EventDetail extends Omit<EventSummary, 'message'> {
  schemaVersion: number
  projectId: string
  appName: string
  sentAt: number
  breadcrumbs: Breadcrumb[]
  replayData: string | null
  payload: Record<string, unknown>
  message?: string
}

export interface EventListData {
  events: EventSummary[]
  nextCursor: string
}

export interface EventFilters {
  category: EventCategory | ''
  eventType: string
}
