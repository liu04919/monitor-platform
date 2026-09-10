import { createEventBase } from '../common/event'
import { safely } from '../common/safe'
import type { MonitorContext, MonitorPlugin, StabilityEvent } from '../types'
import type { StallPluginOptions } from './types'

const DEFAULT_LONG_TASK_THRESHOLD = 50
const DEFAULT_RAF_GAP_THRESHOLD = 120
const DEFAULT_REPORT_INTERVAL = 3000

type StallType = 'longtask' | 'raf_gap'

function reportStall(
  ctx: MonitorContext,
  stallType: StallType,
  duration: number,
  threshold: number,
  startTime: number,
): void {
  const replayData = ctx.getRecordScreenData()

  const reportData: StabilityEvent = {
    ...createEventBase(ctx),

    category: 'stability',
    eventType: 'stutter',
    level: 'warning',

    breadcrumbs: ctx.getBehaviorState(),
    replayData: replayData || undefined,

    payload: {
      message: `${stallType} 持续 ${Math.round(duration)}ms`,

      metrics: {
        duration,
        threshold,
        startTime,
      },
    },
  }

  ctx.report(reportData)
}

function initLongTaskObserver(
  ctx: MonitorContext,
  threshold: number,
  reportInterval: number,
): void {
  if (
    !('PerformanceObserver' in window) ||
    !PerformanceObserver.supportedEntryTypes?.includes('longtask')
  ) {
    return
  }

  let lastReportTime = 0

  const observer = new PerformanceObserver((list) => {
    const now = performance.now()

    if (document.hidden || now - lastReportTime < reportInterval) {
      return
    }

    const entry = list.getEntries().find((item) => item.duration >= threshold)

    if (!entry) {
      return
    }

    lastReportTime = now
    safely(() => reportStall(ctx, 'longtask', entry.duration, threshold, entry.startTime))
  })

  observer.observe({
    type: 'longtask',
    buffered: true,
  })

  ctx.addDispose(() => {
    observer.disconnect()
  })
}

function initRafGapLoop(ctx: MonitorContext, threshold: number, reportInterval: number): void {
  let lastFrameTime: number | undefined
  let lastReportTime = 0
  let isRunning = true
  let frameId: number

  const reset = (): void => {
    lastFrameTime = undefined
  }
  // 后台 rAF 可能完全不执行，不能依赖 loop 内的 document.hidden 分支重置时钟。
  ctx.on(document, 'visibilitychange', reset)
  ctx.on(window, 'pageshow', reset)
  ctx.on(window, 'pagehide', reset)

  const loop = (timestamp: number): void => {
    if (!isRunning) {
      return
    }

    if (document.hidden) {
      lastFrameTime = undefined
      frameId = requestAnimationFrame(loop)
      return
    }

    const previousFrame = lastFrameTime
    const gap = previousFrame === undefined ? 0 : timestamp - previousFrame
    const canReport = gap >= threshold && timestamp - lastReportTime >= reportInterval

    if (canReport) {
      lastReportTime = timestamp
      safely(() => reportStall(ctx, 'raf_gap', gap, threshold, previousFrame!))
    }

    lastFrameTime = timestamp
    frameId = requestAnimationFrame(loop)
  }

  frameId = requestAnimationFrame(loop)

  ctx.addDispose(() => {
    isRunning = false
    cancelAnimationFrame(frameId)
  })
}

export function stallPlugin(options: StallPluginOptions = {}): MonitorPlugin {
  return {
    name: 'ai-performance:stall',
    setup: (ctx) => {
      initLongTaskObserver(
        ctx,
        options.longTaskThreshold || DEFAULT_LONG_TASK_THRESHOLD,
        options.reportInterval || DEFAULT_REPORT_INTERVAL,
      )
      initRafGapLoop(
        ctx,
        options.rafGapThreshold || DEFAULT_RAF_GAP_THRESHOLD,
        options.reportInterval || DEFAULT_REPORT_INTERVAL,
      )
    },
  }
}
