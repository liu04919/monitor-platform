import type { MonitorContext } from '../types'
import { MONITOR_SCHEMA_VERSION } from '../types/events'

export interface EventBaseFields {
  schemaVersion: typeof MONITOR_SCHEMA_VERSION
  eventId: string
  timestamp: number
  pageUrl: string
  userId?: string
}

export function createEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return [Date.now().toString(36), Math.random().toString(36).slice(2)].join('-')
}

export function createEventBase(ctx: MonitorContext): EventBaseFields {
  const config = ctx.getConfig()

  return {
    schemaVersion: MONITOR_SCHEMA_VERSION,
    eventId: createEventId(),
    timestamp: Date.now(),
    pageUrl: typeof window !== 'undefined' ? window.location.href : '',

    userId: config.userId || undefined,
  }
}
