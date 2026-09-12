import { createEventBase } from '../common/event'
import { safely } from '../common/safe'
import { sanitizeUrl } from '../common/sanitize'
import type { MonitorPlugin } from '../types'
import { NAVIGATION_CHANGE } from './navigation'

export const pvPlugin = (): MonitorPlugin => ({
  name: 'behavior:pv',
  deps: ['behavior:navigation'],
  setup(ctx) {
    let initialPending = true
    const report = () =>
      safely(() => {
        initialPending = false
        const pageUrl = sanitizeUrl(location.href)
        const url = new URL(pageUrl)
        const entry = performance.getEntriesByType('navigation')[0] as
          | PerformanceNavigationTiming
          | undefined
        ctx.report({
          ...createEventBase(ctx),
          category: 'behavior',
          eventType: 'page_view',
          payload: {
            message: `view ${url.pathname}${url.hash}`,
            data: {
              url: pageUrl,
              referrer: sanitizeUrl(document.referrer),
              navigationType: entry?.type,
            },
          },
        })
      })
    const reportInitial = () => {
      if (initialPending) report()
    }
    ctx.events.on(NAVIGATION_CHANGE, report)
    if (document.readyState === 'complete') {
      const timer = setTimeout(reportInitial, 0)
      ctx.addDispose(() => clearTimeout(timer))
    } else {
      ctx.on(window, 'pageshow', reportInitial, { once: true })
    }
  },
})
