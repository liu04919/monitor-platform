import { createEventBase } from '../common/event'
import type { MonitorContext, PerformanceEvent } from '../types'

interface ResourceTimingData {
  name: string
  sourceType: string
  duration: number
  dns: number
  tcp: number
  redirect: number
  ttfb: number
  protocol: string
  responseBodySize: number
  responseHeaderSize: number
  transferSize: number
  resourceSize: number
  startTime: number
}

function isSupportResourceObserver(): boolean {
  return (
    'PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('resource')
  )
}

function shouldIgnoreResource(ctx: MonitorContext, entry: PerformanceResourceTiming): boolean {
  const config = ctx.getConfig()

  const reportUrl = new URL(config.url, window.location.href)

  const entryUrl = new URL(entry.name, window.location.href)

  /**
   * 只忽略真正的监控上报接口。
   *
   * 原来的代码比较 origin，会错误地忽略同域的所有资源。
   */
  if (entryUrl.origin === reportUrl.origin && entryUrl.pathname === reportUrl.pathname) {
    return true
  }

  /**
   * fetch/xhr 已经由对应插件上报，避免重复。
   */
  return entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest'
}

function getResponseHeaderSize(entry: PerformanceResourceTiming): number {
  return Math.max(entry.transferSize - entry.encodedBodySize, 0)
}

function formatResourceEntry(entry: PerformanceResourceTiming): ResourceTimingData {
  return {
    name: entry.name,
    sourceType: entry.initiatorType,
    duration: entry.duration,

    dns: entry.domainLookupEnd - entry.domainLookupStart,

    tcp: entry.connectEnd - entry.connectStart,

    redirect: entry.redirectEnd - entry.redirectStart,

    ttfb: entry.responseStart - entry.requestStart,

    protocol: entry.nextHopProtocol,

    responseBodySize: entry.encodedBodySize,
    responseHeaderSize: getResponseHeaderSize(entry),

    transferSize: entry.transferSize,
    resourceSize: entry.decodedBodySize,
    startTime: entry.startTime,
  }
}

export default function observerEntries(ctx: MonitorContext): void {
  if (!isSupportResourceObserver()) {
    return
  }

  const entryHandler = (list: PerformanceObserverEntryList) => {
    const entries = list.getEntries() as PerformanceResourceTiming[]

    const resources = entries
      .filter((entry) => !shouldIgnoreResource(ctx, entry))
      .map(formatResourceEntry)

    if (!resources.length) {
      return
    }

    const reportData: PerformanceEvent = {
      ...createEventBase(ctx),

      category: 'performance',
      eventType: 'resource_timing',

      payload: {
        name: 'resource',
        value: resources.length,
        unit: 'count',

        attributes: {
          resources,
        },
      },
    }

    ctx.report(reportData)
  }

  const observer = new PerformanceObserver(entryHandler)

  ctx.addDispose(() => {
    observer.disconnect()
  })

  observer.observe({
    type: 'resource',
    buffered: true,
  })
}
