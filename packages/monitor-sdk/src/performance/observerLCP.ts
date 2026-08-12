import { createEventBase } from '../common/event'
import type { MonitorContext, PerformanceEvent } from '../types'

interface LargestContentfulPaintEntry extends PerformanceEntry {
  size: number
  element: Element | null
}

function isSupportLCPObserver(): boolean {
  return (
    'PerformanceObserver' in window &&
    PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')
  )
}

export default function observerLCP(ctx: MonitorContext): void {
  if (!isSupportLCPObserver()) {
    return
  }

  let observer: PerformanceObserver | null = null
  let latestEntry: LargestContentfulPaintEntry | null = null
  let reported = false

  const report = () => {
    if (reported || !latestEntry) {
      return
    }

    reported = true
    observer?.disconnect()
    observer = null

    const reportData: PerformanceEvent = {
      ...createEventBase(ctx),

      category: 'performance',
      eventType: 'web_vital',

      payload: {
        name: 'LCP',
        value: latestEntry.startTime,
        unit: 'ms',

        attributes: {
          size: latestEntry.size,
          element: latestEntry.element?.tagName,
        },
      },
    }

    ctx.report(reportData)
    latestEntry = null
  }

  observer = new PerformanceObserver((list) => {
    const entries = list.getEntries() as LargestContentfulPaintEntry[]

    latestEntry = entries[entries.length - 1] || null
  })

  observer.observe({
    type: 'largest-contentful-paint',
    buffered: true,
  })

  ctx.addDispose(() => {
    observer?.disconnect()
    observer = null
  })

  ctx.on(
    document,
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') {
        report()
      }
    },
    { capture: true },
  )

  ctx.on(window, 'pagehide', report, {
    once: true,
    capture: true,
  })
}
