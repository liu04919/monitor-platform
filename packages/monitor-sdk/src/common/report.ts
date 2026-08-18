import { addCache, getCache, clearCache } from './cache'
import { getConfig } from './config'
import type { MonitorEvent } from '../types'
import {
  addReportTask,
  deleteReportTask,
  getDueReportTasks,
  putReportTask,
  type ReportTask,
} from './report-db'

type SendType = 'fetch' | 'beacon'

const MAX_RETRY_COUNT = 5
const BASE_RETRY_DELAY = 1_000
const MAX_RETRY_DELAY = 60_000
const RETRY_QUEUE_LIMIT = 20
const RETRY_CHECK_INTERVAL = 30_000

/**
 * 提前保存原始 Fetch，避免你的 Fetch 监控插件拦截监控 SDK
 * 自己的上报请求，产生递归上报。
 */
const originalFetch = typeof window !== 'undefined' ? window.fetch?.bind(window) : undefined

let isScheduled = false
let isFlushingOfflineQueue = false
let isLifecycleInitialized = false

class HttpRequestError extends Error {
  status: number

  constructor(status: number) {
    super(`Fetch request failed: ${status}`)
    this.name = 'HttpRequestError'
    this.status = status
  }
}

function createBatchId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return [Date.now().toString(36), Math.random().toString(36).slice(2)].join('-')
}

function createReportTask(events: MonitorEvent[]): ReportTask {
  const config = getConfig()
  const batchId = createBatchId()

  return {
    id: batchId,
    url: config.url,

    payload: {
      schemaVersion: 2,
      batchId,
      sentAt: Date.now(),
      publicKey: config.publicKey,

      app: {
        id: config.appId,
        name: config.projectName,
      },

      events,
    },

    createdAt: Date.now(),
    retryCount: 0,
    nextRetryAt: Date.now(),
  }
}

function serializeReportTask(task: ReportTask, sendType: SendType): string {
  return JSON.stringify({
    ...task.payload,
    sendType,
  })
}

function runCallback(callback: any, data: unknown): void {
  if (typeof callback === 'function') {
    callback(data)
  }
}

function runReportBefore(task: ReportTask): void {
  const config = getConfig()

  runCallback(config.reportBefore, task.payload.events)
}

function runReportSuccess(task: ReportTask): void {
  const config = getConfig()

  runCallback(config.reportSuccess, task.payload.events)
}

function runReportFail(task: ReportTask): void {
  const config = getConfig()

  runCallback(config.reportFail, task.payload.events)
}

function runReportAfter(task: ReportTask): void {
  const config = getConfig()

  console.log('埋点上报----', task.payload.events)

  runCallback(config.reportAfter, task.payload.events)
}

function isSupportSendBeacon(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
}

/**
 * 正常上报以及 Beacon 失败后的降级上报。
 */
async function fetchRequest(task: ReportTask, keepalive = false): Promise<Response> {
  if (!originalFetch) {
    throw new Error('Fetch is not supported')
  }

  const body = serializeReportTask(task, 'fetch')

  const response = await originalFetch(task.url, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
    },

    body,
    keepalive,
  })

  if (!response.ok) {
    throw new HttpRequestError(response.status)
  }

  return response
}

/**
 * sendBeacon 返回 true，只代表浏览器接受了发送任务，
 * 并不代表服务端已经成功保存。
 */
function beaconRequest(task: ReportTask): boolean {
  if (!isSupportSendBeacon()) {
    return false
  }

  const body = serializeReportTask(task, 'beacon')

  // text/plain 属于 CORS 简单请求类型。页面退出时不能依赖 application/json
  // 触发的异步预检，否则导航可能在真正的 Beacon POST 前结束请求。
  const blob = new Blob([body], {
    type: 'text/plain;charset=UTF-8',
  })

  return navigator.sendBeacon(task.url, blob)
}

function isRetryableError(error: unknown): boolean {
  /**
   * Fetch 遇到断网、DNS 失败等情况通常直接抛出异常，
   * 没有 HTTP 状态码，这种情况应该重试。
   */
  if (!(error instanceof HttpRequestError)) {
    return true
  }

  const { status } = error

  return status === 408 || status === 429 || status >= 500
}

function getRetryDelay(retryCount: number): number {
  const maxDelay = Math.min(BASE_RETRY_DELAY * 2 ** (retryCount - 1), MAX_RETRY_DELAY)

  const minDelay = maxDelay / 2

  return minDelay + Math.random() * (maxDelay - minDelay)
}

async function scheduleRetry(task: ReportTask, error: unknown): Promise<void> {
  const nextRetryCount = task.retryCount + 1

  const shouldDiscard = !isRetryableError(error) || nextRetryCount > MAX_RETRY_COUNT

  if (shouldDiscard) {
    await deleteReportTask(task.id)
    return
  }

  await putReportTask({
    ...task,

    retryCount: nextRetryCount,

    nextRetryAt: Date.now() + getRetryDelay(nextRetryCount),
  })
}

/**
 * 发送一个已经存入 IndexedDB 的任务。
 *
 * 成功：删除 IndexedDB 任务。
 * 失败：更新 retryCount 和 nextRetryAt。
 */
async function sendPersistedTaskByFetch(task: ReportTask, keepalive = false): Promise<boolean> {
  try {
    await fetchRequest(task, keepalive)

    /**
     * 网络请求已经成功。
     *
     * 即使这里删除 IndexedDB 失败，服务端仍然可以通过
     * batchId 做幂等处理。
     */
    try {
      await deleteReportTask(task.id)
    } catch (error) {
      console.warn('Failed to remove reported task from IndexedDB:', error)
    }

    runReportSuccess(task)

    return true
  } catch (error) {
    runReportFail(task)

    try {
      await scheduleRetry(task, error)
    } catch (databaseError) {
      console.warn('Failed to update retry task:', databaseError)
    }

    return false
  } finally {
    runReportAfter(task)
  }
}

/**
 * 正常情况下的批量上报：
 *
 * 1. 清空内存缓存；
 * 2. 创建唯一批次；
 * 3. 先写 IndexedDB；
 * 4. 再通过 Fetch 上报；
 * 5. 成功后删除 IndexedDB 记录。
 */
async function flushReport(): Promise<void> {
  isScheduled = false

  const dataCache = getCache()

  if (!dataCache.length) {
    return
  }

  const list = dataCache.slice()
  clearCache()

  const task = createReportTask(list)

  runReportBefore(task)

  let persisted = false

  try {
    await addReportTask(task)
    persisted = true
  } catch (error) {
    /**
     * IndexedDB 可能因为隐私模式、配额或浏览器限制失败。
     *
     * 此时降级为直接 Fetch，至少不要让整个监控 SDK
     * 因为本地数据库失败而停止工作。
     */
    console.warn('Failed to persist report task:', error)
  }

  if (persisted) {
    await sendPersistedTaskByFetch(task)
    return
  }

  /**
   * IndexedDB 不可用时的降级发送。
   */
  try {
    await fetchRequest(task)

    runReportSuccess(task)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    runReportFail(task)

    /**
     * Fetch 和 IndexedDB 都失败时，只能重新放回内存。
     * 但页面如果随后被彻底关闭，这部分仍然可能丢失。
     */
    list.forEach(addCache)
  } finally {
    runReportAfter(task)
  }
}

function scheduleFlush(): void {
  if (isScheduled) {
    return
  }

  isScheduled = true

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(
      () => {
        void flushReport()
      },
      {
        timeout: 1_000,
      },
    )

    return
  }

  setTimeout(() => {
    void flushReport()
  }, 1_000)
}

export function lazyReportBatch(event: MonitorEvent): void {
  const config = getConfig()

  addCache(event)

  const dataCache = getCache()
  const batchSize = Math.max(config.batchSize || 1, 1)

  if (dataCache.length >= batchSize) {
    void flushReport()
    return
  }

  scheduleFlush()
}

/**
 * Beacon 失败后的 Fetch keepalive 降级。
 *
 * IndexedDB 持久化和 Fetch 同时开始，避免在页面卸载阶段
 * 等待 IndexedDB 完成后才发送网络请求。
 */
async function sendExitFetchFallback(
  task: ReportTask,
  persistPromise: Promise<boolean>,
): Promise<void> {
  try {
    await fetchRequest(task, true)

    const persisted = await persistPromise

    if (persisted) {
      try {
        await deleteReportTask(task.id)
      } catch (error) {
        console.warn('Failed to remove exit report task:', error)
      }
    }

    runReportSuccess(task)
  } catch (error) {
    const persisted = await persistPromise

    if (persisted) {
      try {
        await scheduleRetry(task, error)
      } catch (databaseError) {
        console.warn('Failed to schedule exit report retry:', databaseError)
      }
    }

    runReportFail(task)
  } finally {
    runReportAfter(task)
  }
}

/**
 * 页面进入隐藏或卸载阶段时调用。
 */
function flushCurrentCacheOnExit(): void {
  isScheduled = false

  const dataCache = getCache()

  if (!dataCache.length) {
    return
  }

  const list = dataCache.slice()
  clearCache()

  const task = createReportTask(list)

  runReportBefore(task)

  /**
   * 开始持久化，但不要阻塞 Beacon。
   */
  const persistPromise = addReportTask(task)
    .then(() => true)
    .catch((error) => {
      console.warn('Failed to persist exit report:', error)

      return false
    })

  const beaconAccepted = beaconRequest(task)

  if (beaconAccepted) {
    /**
     * 不能调用 reportSuccess。
     *
     * Beacon 返回 true 只说明浏览器把数据加入了发送队列，
     * 无法证明服务端真正处理成功。
     *
     * 因此任务继续保留在 IndexedDB，下次启动时再用 Fetch
     * 获取明确响应。服务端通过 batchId 去重。
     */
    runReportAfter(task)
    return
  }

  /**
   * Beacon 不支持或返回 false，降级为 Fetch keepalive。
   */
  void sendExitFetchFallback(task, persistPromise)
}

/**
 * 从 IndexedDB 消费离线任务。
 */
export async function flushOfflineQueue(): Promise<void> {
  if (typeof window === 'undefined' || isFlushingOfflineQueue) {
    return
  }

  isFlushingOfflineQueue = true

  try {
    const tasks = await getDueReportTasks(Date.now(), RETRY_QUEUE_LIMIT)

    /**
     * 这里使用串行发送，避免断网恢复时瞬间产生大量请求。
     */
    for (const task of tasks) {
      await sendPersistedTaskByFetch(task)
    }
  } catch (error) {
    console.warn('Failed to flush offline report queue:', error)
  } finally {
    isFlushingOfflineQueue = false
  }
}

/**
 * 注册页面生命周期和重试机制。
 *
 * 在你的 Monitor.init 或 SDK init 阶段调用一次。
 */
export function initReportTransport(): () => void {
  if (typeof window === 'undefined' || isLifecycleInitialized) {
    return () => {}
  }

  isLifecycleInitialized = true

  const handleOnline = () => {
    void flushOfflineQueue()
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      flushCurrentCacheOnExit()
      return
    }

    /**
     * 页面重新可见时，尝试确认之前通过 Beacon
     * 发送但尚未从 IndexedDB 删除的任务。
     */
    void flushOfflineQueue()
  }

  const handlePageHide = () => {
    flushCurrentCacheOnExit()
  }

  window.addEventListener('online', handleOnline)

  document.addEventListener('visibilitychange', handleVisibilityChange)

  window.addEventListener('pagehide', handlePageHide)

  const retryTimer = window.setInterval(() => {
    void flushOfflineQueue()
  }, RETRY_CHECK_INTERVAL)

  /**
   * SDK 初始化时先消费上一次遗留的任务。
   */
  void flushOfflineQueue()

  return () => {
    window.removeEventListener('online', handleOnline)

    document.removeEventListener('visibilitychange', handleVisibilityChange)

    window.removeEventListener('pagehide', handlePageHide)

    window.clearInterval(retryTimer)

    isLifecycleInitialized = false
  }
}
