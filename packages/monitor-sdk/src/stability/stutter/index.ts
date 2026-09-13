import type { EventBaseFields } from '../../common/event'
import { safely } from '../../common/safe'
import type { MonitorContext, MonitorPlugin } from '../../types'
import { matchingSamples, rememberSample } from './evidence'
import { frameEventBase, readSlowFrame, reportSlowFrame } from './report'
import {
  stutterOptions,
  type LoafEntry,
  type SlowFrame,
  type StutterOptions,
  type TimingSample,
} from './types'

export type { StutterOptions } from './types'

const EVIDENCE_WAIT_MS = 200
const MIN_RAF_GAP_MS = 50

function observe(
  type: string,
  callback: PerformanceObserverCallback,
): PerformanceObserver | undefined {
  if (!PerformanceObserver.supportedEntryTypes.includes(type)) return
  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver(callback)
    // 不补采安装之前、后台期间或上一个可见周期的历史条目。
    observer.observe({ type, buffered: false })
    return observer
  } catch {
    observer?.disconnect()
  }
}

function startStutter(ctx: MonitorContext, options: Required<StutterOptions>): void {
  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')
  )
    return

  let active = false
  let destroyed = false
  let pageSuspended = false
  let activeSince = 0
  let lastReportedStart = -Infinity
  let lastFrameTime: number | undefined
  let rafId: number | undefined
  let loafObserver: PerformanceObserver | undefined
  let longTaskObserver: PerformanceObserver | undefined
  let reportTimer: ReturnType<typeof setTimeout> | undefined
  let pending: { frame: SlowFrame; base: EventBaseFields } | undefined
  const longTasks: TimingSample[] = []
  const rafGaps: TimingSample[] = []

  function belongsToVisiblePeriod(sample: TimingSample): boolean {
    return active && !document.hidden && sample.startTime >= activeSince
  }

  function flush(): void {
    reportTimer = undefined
    const current = pending
    pending = undefined
    if (!current || !active || document.hidden) return
    const { frame, base } = current
    lastReportedStart = frame.startTime
    const now = performance.now()
    reportSlowFrame(
      ctx,
      base,
      frame,
      options.durationThresholdMs,
      matchingSamples(longTasks, frame, now),
      matchingSamples(rafGaps, frame, now),
    )
  }

  function onSlowFrames(list: PerformanceObserverEntryList): void {
    for (const entry of list.getEntries() as LoafEntry[]) {
      if (!belongsToVisiblePeriod(entry) || entry.duration < options.durationThresholdMs) continue
      if (entry.startTime - lastReportedStart < options.reportIntervalMs) continue
      // 同一个 200ms 等待窗口只保留最慢的一帧，不为每条条目创建计时器或附件。
      if (pending && pending.frame.duration >= entry.duration) continue
      safely(() => {
        const frame = readSlowFrame(entry)
        pending = { frame, base: frameEventBase(ctx, frame) }
        reportTimer ??= setTimeout(flush, EVIDENCE_WAIT_MS)
      })
    }
  }

  function onLongTasks(list: PerformanceObserverEntryList): void {
    for (const entry of list.getEntries()) {
      if (belongsToVisiblePeriod(entry)) rememberSample(longTasks, entry, performance.now())
    }
  }

  function onFrame(timestamp: number): void {
    if (!active || document.hidden) return
    if (lastFrameTime !== undefined && lastFrameTime >= activeSince) {
      const duration = timestamp - lastFrameTime
      // 正常帧只更新时钟，不逐帧分配样本对象。
      if (duration >= MIN_RAF_GAP_MS) {
        rememberSample(rafGaps, { startTime: lastFrameTime, duration }, performance.now())
      }
    }
    lastFrameTime = timestamp
    rafId = requestAnimationFrame(onFrame)
  }

  function start(): void {
    if (destroyed || active || pageSuspended || document.hidden) return
    activeSince = performance.now()
    active = true
    loafObserver = observe('long-animation-frame', onSlowFrames)
    if (!loafObserver) {
      active = false
      return
    }
    longTaskObserver = observe('longtask', onLongTasks)
    if (options.includeRafGap && typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(onFrame)
    }
  }

  function stop(): void {
    active = false
    loafObserver?.disconnect()
    longTaskObserver?.disconnect()
    if (rafId !== undefined) cancelAnimationFrame(rafId)
    if (reportTimer !== undefined) clearTimeout(reportTimer)
    loafObserver = undefined
    longTaskObserver = undefined
    rafId = undefined
    reportTimer = undefined
    pending = undefined
    lastFrameTime = undefined
    longTasks.length = 0
    rafGaps.length = 0
  }

  function suspend(): void {
    pageSuspended = true
    stop()
  }
  function resume(): void {
    pageSuspended = false
    start()
  }
  ctx.on(document, 'visibilitychange', () => {
    if (document.hidden) stop()
    else start()
  })
  ctx.on(window, 'pagehide', suspend)
  ctx.on(window, 'pageshow', resume)
  ctx.on(document, 'freeze', suspend)
  ctx.on(document, 'resume', resume)
  ctx.addDispose(() => {
    destroyed = true
    stop()
  })
  start()
}

export function stutterPlugin(input: StutterOptions = {}): MonitorPlugin {
  const options = stutterOptions(input)
  return { name: 'stability:stutter', setup: (ctx) => startStutter(ctx, options) }
}
