import 'fake-indexeddb/auto'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { vi } from 'vitest'
import type { MonitorContext, MonitorEvent, MonitorPlugin } from '../src/types'

export function event(id: string = crypto.randomUUID(), message = 'test'): MonitorEvent {
  return {
    schemaVersion: 2,
    eventId: id,
    timestamp: Date.now(),
    pageUrl: 'https://example.com/',
    category: 'error',
    eventType: 'js_error',
    level: 'error',
    breadcrumbs: [],
    payload: {
      exception: { name: 'Error', message, stack: [] },
      mechanism: { type: 'window.onerror', handled: false },
    },
  }
}

export function capture(): { plugin: MonitorPlugin; context: () => MonitorContext } {
  let ctx: MonitorContext
  return {
    plugin: {
      name: 'test',
      setup(context) {
        ctx = context
      },
    },
    context: () => ctx,
  }
}

export function browser(): void {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  visible(true)
}

export function visible(value: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: !value })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: value ? 'visible' : 'hidden',
  })
}

export async function eventually(check: () => boolean): Promise<void> {
  // IndexedDB 使用真正的任务调度；不推进测试里的重试时钟。
  for (let i = 0; i < 1000; i++) {
    if (check()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('condition did not become true')
}
