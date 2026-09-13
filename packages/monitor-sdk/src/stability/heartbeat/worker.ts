import { createEventId } from '../../common/event'
import { ReportTransport } from '../../transport'
import { MONITOR_SCHEMA_VERSION, type ConfigType, type StabilityEvent } from '../../types'
import { HeartbeatWatchdog } from './watchdog'
import type { HeartbeatSnapshot, MainMessage, WorkerMessage } from './types'

const worker = self as unknown as {
  onmessage: (event: MessageEvent<MainMessage>) => void
  postMessage: (message: WorkerMessage) => void
}

let watchdog: HeartbeatWatchdog | undefined
let snapshot: HeartbeatSnapshot
let snapshotAt: number | undefined

worker.onmessage = ({ data }) => {
  if (data.type === 'init') {
    if (watchdog) return
    const { config, options } = data
    snapshot = { pageUrl: data.pageUrl, breadcrumbs: [], replayData: '' }
    const transportConfig: ConfigType = {
      ...config,
      batchSize: 1,
      isAjax: false,
      reportDrop: (info) => worker.postMessage({ type: 'drop', info }),
    }
    // 函数留在主线程，Worker 只把回调名称和事件结果交回去。
    for (const name of data.callbacks) {
      transportConfig[name] = (events) => worker.postMessage({ type: 'callback', name, events })
    }
    const transport = new ReportTransport(transportConfig)
    watchdog = new HeartbeatWatchdog(
      options,
      (id) => worker.postMessage({ type: 'ping', id }),
      (unresponsiveDuration) => {
        const event: StabilityEvent = {
          schemaVersion: MONITOR_SCHEMA_VERSION,
          eventId: createEventId(),
          timestamp: Date.now(),
          pageUrl: snapshot.pageUrl,
          userId: config.userId || undefined,
          category: 'stability',
          eventType: 'crash',
          level: 'error',
          breadcrumbs: snapshot.breadcrumbs,
          replayData: snapshot.replayData || undefined,
          payload: {
            message: '主线程长时间无响应',
            metrics: {
              timeout: options.timeoutMs,
              unresponsiveDuration,
              ...(snapshotAt === undefined
                ? {}
                : { snapshotAgeMs: performance.now() - snapshotAt }),
            },
          },
        }
        // 和普通事件使用同一传输实现：大小限制、持久队列、HTTP 检查和重试。
        transport.report(event)
      },
    )
    watchdog.setActive(data.active)
    return
  }

  if (data.type === 'pong') watchdog?.pong(data.id)
  if (data.type === 'active') watchdog?.setActive(data.active)
  if (data.type === 'snapshot') {
    snapshot = data.snapshot
    snapshotAt = performance.now()
  }
}
