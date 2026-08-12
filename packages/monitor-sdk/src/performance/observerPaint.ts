import { createEventBase } from '../common/event'
import type { MonitorContext, PerformanceEvent } from '../types'

function isSupportPaintObserver(): boolean {
  return (
    'PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('paint')
  )
}

export default function observerPaint(ctx: MonitorContext): void {
  if (!isSupportPaintObserver()) {
    return
  }

  let observer: PerformanceObserver | null = null

  const entryHandler = (list: PerformanceObserverEntryList) => {
    const entry = list.getEntries().find((item) => item.name === 'first-paint')

    if (!entry) {
      return
    }

    observer?.disconnect()
    observer = null

    const reportData: PerformanceEvent = {
      ...createEventBase(ctx),

      category: 'performance',
      eventType: 'web_vital',

      payload: {
        name: 'FP',
        value: entry.startTime,
        unit: 'ms',

        attributes: {
          entryType: entry.entryType,
        },
      },
    }

    ctx.report(reportData)
  }

  observer = new PerformanceObserver(entryHandler)

  ctx.addDispose(() => {
    observer?.disconnect()
    observer = null
  })

  observer.observe({
    type: 'paint',
    buffered: true,
  })
}
