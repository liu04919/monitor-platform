import { createEventBase } from '../common/event'
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

    if (now - lastReportTime < reportInterval) {
      return
    }

    const entry = list.getEntries().find((item) => item.duration >= threshold)

    if (!entry) {
      return
    }

    lastReportTime = now
    reportStall(ctx, 'longtask', entry.duration, threshold, entry.startTime)
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
  let lastFrameTime = performance.now()
  let lastReportTime = 0
  let isRunning = true

  const loop = (timestamp: number): void => {
    if (!isRunning) {
      return
    }

    if (document.hidden) {
      lastFrameTime = timestamp
      requestAnimationFrame(loop)
      return
    }

    const gap = timestamp - lastFrameTime
    const canReport = gap >= threshold && timestamp - lastReportTime >= reportInterval

    if (canReport) {
      lastReportTime = timestamp
      reportStall(ctx, 'raf_gap', gap, threshold, lastFrameTime)
    }

    lastFrameTime = timestamp
    requestAnimationFrame(loop)
  }

  requestAnimationFrame(loop)

  ctx.addDispose(() => {
    isRunning = false
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
