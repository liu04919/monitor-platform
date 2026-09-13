import { runInNewContext } from 'node:vm'
import {
  IDBFactory,
  IDBKeyRange,
  IDBRequest,
  IDBDatabase,
  IDBTransaction,
  IDBObjectStore,
  IDBIndex,
  IDBCursor,
} from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainMessage, WorkerMessage } from '../src/stability/heartbeat/types'
import { eventually } from './helpers'

// 和生产构建使用相同的、已打包 Worker 代码；沙箱没有 window/document。
declare const __MONITOR_HEARTBEAT_WORKER__: string
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>
let db: IDBFactory

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  })
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }))
  db = new IDBFactory()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

function start(transport = {}, online = true) {
  const messages: WorkerMessage[] = []
  const globals = {
    Date,
    Math,
    JSON,
    URL,
    TextEncoder,
    AbortController,
    crypto,
    performance,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: fetcher,
    navigator: { onLine: online },
    indexedDB: db,
    IDBKeyRange,
    IDBRequest,
    IDBDatabase,
    IDBTransaction,
    IDBObjectStore,
    IDBIndex,
    IDBCursor,
    onmessage: (_event: { data: MainMessage }) => {
      void _event
    },
    postMessage: (message: WorkerMessage) => messages.push(message),
  }
  runInNewContext(__MONITOR_HEARTBEAT_WORKER__, Object.assign(globals, { self: globals }))
  const send = (data: MainMessage) => globals.onmessage({ data })
  send({
    type: 'init',
    config: {
      url: 'https://monitor.test/collect',
      appId: 'a',
      publicKey: 'pk',
      projectName: 'A',
      userId: 'u',
      transport,
    },
    options: { intervalMs: 5000, timeoutMs: 15000, snapshotIntervalMs: 10000 },
    pageUrl: 'https://app.test/page',
    active: true,
    callbacks: ['reportSuccess', 'reportFail'],
  })
  return { send, messages, globals }
}

async function queued() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = db.open('monitor-sdk')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  try {
    return await new Promise<any[]>((resolve, reject) => {
      const get = database.transaction('reportQueue').objectStore('reportQueue').getAll()
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    })
  } finally {
    database.close()
  }
}

async function waitQueueCount(count: number) {
  for (let i = 0; i < 100; i++) {
    if ((await queued()).length === count) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`queue count did not become ${count}`)
}

function body(index = 0) {
  return JSON.parse(fetcher.mock.calls[index][1]!.body as string)
}

describe('独立 Worker 复用持久传输', () => {
  it('构建产物无主线程环境也能组包、保存、发送并确认 202', async () => {
    const { send, messages } = start()
    send({
      type: 'snapshot',
      snapshot: { pageUrl: 'https://app.test/latest', replayData: 'recording', breadcrumbs: [] },
    })
    await vi.advanceTimersByTimeAsync(15000)
    await eventually(() => fetcher.mock.calls.length === 1)
    await waitQueueCount(0)
    expect(body()).toMatchObject({
      schemaVersion: 2,
      publicKey: 'pk',
      app: { id: 'a', name: 'A' },
      sendType: 'fetch',
      events: [
        {
          eventType: 'crash',
          category: 'stability',
          replayData: 'recording',
          pageUrl: 'https://app.test/latest',
          userId: 'u',
          payload: { metrics: { timeout: 15000, unresponsiveDuration: 15000 } },
        },
      ],
    })
    expect(body().batchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(messages.filter((message) => message.type === 'drop')).toEqual([])
    await eventually(() => messages.some((message) => message.type === 'callback'))
    expect(messages).toContainEqual({
      type: 'callback',
      name: 'reportSuccess',
      events: body().events,
    })
  })

  it.each([500, 429, 'network', 'timeout'])(
    '%s 失败后自动重试，保持完全相同的批次身份和内容',
    async (failure) => {
      if (failure === 'network') fetcher.mockRejectedValueOnce(new TypeError('offline'))
      else if (failure === 'timeout') fetcher.mockImplementationOnce(() => new Promise(() => {}))
      else fetcher.mockResolvedValueOnce(new Response(null, { status: Number(failure) }))
      start({ requestTimeoutMs: 100, maxRetries: 1 })
      await vi.advanceTimersByTimeAsync(15000)
      await eventually(() => fetcher.mock.calls.length === 1)
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(100)
      // 等待失败结果写回 IndexedDB，再推进重试时钟。
      for (let i = 0; i < 100; i++) {
        if ((await queued())[0]?.retryCount === 1) break
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      expect((await queued())[0].retryCount).toBe(1)
      await vi.advanceTimersByTimeAsync(2000)
      await eventually(() => fetcher.mock.calls.length === 2)
      await waitQueueCount(0)
      expect(body(1)).toEqual(body(0))
    },
  )

  it.each([400, 401, 413])('HTTP %s 不做无意义重试，但心跳仍继续检测下一次异常', async (status) => {
    fetcher.mockResolvedValue(new Response(null, { status }))
    const { send, messages } = start()
    await vi.advanceTimersByTimeAsync(15000)
    await eventually(() => messages.some((message) => message.type === 'drop'))
    expect(messages).toContainEqual({
      type: 'drop',
      info: { reason: 'http_rejected', batchId: body().batchId },
    })
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const ping = messages.filter((message) => message.type === 'ping').at(-1)!
    send({ type: 'pong', id: ping.id })
    await vi.advanceTimersByTimeAsync(15000)
    await eventually(() => fetcher.mock.calls.length === 2)
    await waitQueueCount(0)
    expect(body(1).events[0].eventId).not.toBe(body().events[0].eventId)
  })

  it('离线期间由 Worker 保存到 IndexedDB，恢复联网后再发送', async () => {
    const { globals } = start({}, false)
    await vi.advanceTimersByTimeAsync(15000)
    await waitQueueCount(1)
    expect(fetcher).not.toHaveBeenCalled()
    const stored = (await queued())[0]
    globals.navigator.onLine = true
    await vi.advanceTimersByTimeAsync(1000)
    await eventually(() => fetcher.mock.calls.length === 1)
    await waitQueueCount(0)
    expect(body().batchId).toBe(stored.id)
  })

  it('超出批次上限时走统一丢弃回调，不发出超大请求', async () => {
    const { send, messages } = start({ maxBatchBytes: 1024 })
    send({
      type: 'snapshot',
      snapshot: { pageUrl: '', breadcrumbs: [], replayData: 'x'.repeat(5000) },
    })
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetcher).not.toHaveBeenCalled()
    expect(messages).toContainEqual({
      type: 'drop',
      info: { reason: 'event_too_large', eventId: expect.any(String) },
    })
  })
})
