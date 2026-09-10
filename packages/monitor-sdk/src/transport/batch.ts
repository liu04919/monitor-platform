import { createEventId } from '../common/event'
import type { ConfigType, MonitorEvent } from '../types'
import type { ReportTask } from './types'

export function scopeFor(config: ConfigType): string {
  return JSON.stringify([config.url, config.appId, config.publicKey])
}

export function createBatch(config: ConfigType, events: MonitorEvent[]): ReportTask {
  const id = createEventId()
  const createdAt = Date.now()
  const body = JSON.stringify({
    schemaVersion: 2,
    batchId: id,
    sentAt: createdAt,
    publicKey: config.publicKey,
    app: { id: config.appId, name: config.projectName },
    events,
  })
  return {
    id,
    scope: scopeFor(config),
    url: config.url,
    body,
    bytes: new TextEncoder().encode(withSendType(body, 'beacon')).byteLength,
    createdAt,
    retryCount: 0,
    nextRetryAt: createdAt,
  }
}

export function withSendType(body: string, sendType: 'fetch' | 'beacon'): string {
  return `${body.slice(0, -1)},"sendType":"${sendType}"}`
}
