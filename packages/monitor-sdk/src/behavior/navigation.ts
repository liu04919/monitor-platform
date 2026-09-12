import { createEventBase } from '../common/event'
import { safely } from '../common/safe'
import { sanitizeUrl } from '../common/sanitize'
import type { MonitorPlugin } from '../types'
import { installHistoryEvents } from './history'

export const NAVIGATION_CHANGE = 'navigation:change'
export interface NavigationChange {
  from: string
  to: string
  jumpType: string
  timestamp: number
  elapsedMs: number
}

export const navigationPlugin = (): MonitorPlugin => ({
  name: 'behavior:navigation',
  setup(ctx) {
    let currentUrl = sanitizeUrl(location.href)
    let startedAt = performance.now()
    const notify = (jumpType: string) =>
      safely(() => {
        const to = sanitizeUrl(location.href)
        // popstate/hashchange 可能属于同一次导航；仅更新 state/query 也不算新页面。
        if (!to || to === currentUrl) return
        const route: NavigationChange = {
          from: currentUrl,
          to,
          jumpType,
          timestamp: Date.now(),
          elapsedMs: Math.max(0, performance.now() - startedAt),
        }
        currentUrl = to
        startedAt = performance.now()
        ctx.addBreadcrumb({
          category: 'navigation',
          timestamp: route.timestamp,
          message: `${route.from} -> ${route.to}`,
          data: { ...route },
        })
        ctx.report({
          ...createEventBase(ctx),
          category: 'behavior',
          eventType: 'route_change',
          payload: { message: `${route.from} -> ${route.to}`, data: { ...route } },
        })
        ctx.events.emit<NavigationChange>(NAVIGATION_CHANGE, route)
      })
    ctx.addDispose(installHistoryEvents())
    ctx.on(window, 'pushstate', () => notify('pushState'))
    ctx.on(window, 'replacestate', () => notify('replaceState'))
    ctx.on(window, 'popstate', () => notify('popstate'))
    ctx.on(window, 'hashchange', () => notify('hashchange'))
  },
})
