import { createEventBase } from '../common/event'
import type { MonitorContext, PerformanceEvent } from '../types'

function getLoadDuration(): number {
  const navigationEntry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined

  if (navigationEntry?.loadEventEnd) {
    return navigationEntry.loadEventEnd
  }

  return performance.now()
}

function reportLoadTime(ctx: MonitorContext): void {
  const duration = getLoadDuration()

  const reportData: PerformanceEvent = {
    ...createEventBase(ctx),

    category: 'performance',
    eventType: 'page_load',

    payload: {
      name: 'page-load',
      value: duration,
      unit: 'ms',
    },
  }

  ctx.report(reportData)
}

export default function observePageLoadTime(ctx: MonitorContext): void {
  const navigationEntry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined

  if (navigationEntry?.loadEventEnd) {
    reportLoadTime(ctx)
    return
  }

  ctx.on(
    window,
    'load',
    () => {
      setTimeout(() => reportLoadTime(ctx), 0)
    },
    { once: true, capture: true },
  )
}
