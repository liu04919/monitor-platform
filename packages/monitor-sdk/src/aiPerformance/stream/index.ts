import { safely } from '../../common/safe'
import { sanitizeData, sanitizeUrl } from '../../common/sanitize'
import type { MonitorContext, MonitorPlugin } from '../../types'
import type { AiStreamPluginOptions } from '../types'
import { observeStreamResponse } from './body'
import { createStreamMeasurement } from './measurement'
import type { StreamMeasurement } from './measurement'

// 与 HTTP 采集器相同：只管理本插件的包装，不能覆盖其他库后来安装的 Fetch。
const wrappers = new WeakMap<typeof fetch, { original: typeof fetch; active: () => boolean }>()

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return String(input)
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

function getRequestSignal(input: RequestInfo | URL, init?: RequestInit) {
  // 显式传 null 表示不继承 Request 的信号，不能用 ?? 合并。
  if (init?.signal !== undefined) return init.signal
  if (input instanceof Request) return input.signal
  return undefined
}

function isReportUrl(url: string, reportUrl: string): boolean {
  const requestUrl = new URL(url, window.location.href)
  const targetUrl = new URL(reportUrl, window.location.href)
  return requestUrl.origin === targetUrl.origin && requestUrl.pathname === targetUrl.pathname
}

export function aiStreamPlugin(input: AiStreamPluginOptions = {}): MonitorPlugin {
  const stallThreshold = input.stallThreshold ?? 2000
  if (!Number.isFinite(stallThreshold) || stallThreshold <= 0 || stallThreshold > 2_147_483_647) {
    throw new Error('[monitor-sdk] stallThreshold 必须是大于 0 且不超过 2147483647 的有限数字')
  }
  // 复制数组，避免调用者后续修改配置影响当前实例。
  const patterns = [...(input.urlPatterns ?? ['/api/chat'])]
  const getMeta = input.getMeta

  return {
    name: 'ai-performance:stream',
    setup(ctx: MonitorContext) {
      if (
        typeof window === 'undefined' ||
        typeof window.fetch !== 'function' ||
        typeof TransformStream !== 'function' ||
        typeof ReadableStream !== 'function'
      )
        return

      const originalFetch = window.fetch
      // 只登记正在等待的计时器，不长期持有业务从未消费的所有 Response / 统计对象。
      const timers = new Set<number>()
      let active = true

      function startMeasurement(
        input: RequestInfo | URL,
        init: RequestInit | undefined,
        requestStart: number,
      ): StreamMeasurement | undefined {
        if (!active) return
        try {
          const url = getRequestUrl(input)
          if (isReportUrl(url, ctx.getConfig().url)) return
          if (!patterns.some((pattern) => url.includes(pattern))) return
          let meta: Record<string, unknown> | undefined
          safely(() => {
            const value = getMeta?.(url, input, init)
            if (value && typeof value.then === 'function') {
              // getMeta 只支持同步结果；误传异步回调也不能留下未处理的拒绝。
              safely(() => value)
              return
            }
            if (value) meta = sanitizeData(value)
          })
          if (!active) return
          return createStreamMeasurement(
            ctx,
            {
              url: sanitizeUrl(url),
              method: getRequestMethod(input, init),
              pageUrl: sanitizeUrl(window.location.href),
              meta,
              requestStart,
              signal: getRequestSignal(input, init),
            },
            stallThreshold,
            timers,
            () => active,
          )
        } catch {
          // 读取配置失败，只放弃采集，不影响已经发出的请求。
          return undefined
        }
      }

      async function measuredFetch(this: Window, input: RequestInfo | URL, init?: RequestInit) {
        const requestStart = performance.now()
        // 先发业务请求；getMeta 和 report 的异常不能阻止或重复发起它。
        const request = originalFetch.call(this, input, init)
        const measurement = startMeasurement(input, init, requestStart)

        let response: Response
        try {
          response = await request
        } catch (error) {
          measurement?.finish('error', error)
          throw error
        }
        if (!active || !measurement) return response
        if (response.status === 0) {
          measurement.dispose()
          return response
        }
        measurement.responseStarted(response)
        // 浏览器的 204 / 205 / 304 可能仍暴露空 ReadableStream；这些状态不能带 body 重建 Response。
        if (!response.body || [204, 205, 304].includes(response.status)) {
          measurement.finish('end')
          return response
        }
        try {
          return observeStreamResponse(response, measurement)
        } catch {
          // 包装准备失败时尚未读取业务流，放弃本次采集，返回原始响应。
          measurement.dispose()
          return response
        }
      }

      window.fetch = measuredFetch
      wrappers.set(measuredFetch, { original: originalFetch, active: () => active })
      return () => {
        if (!active) return
        active = false
        timers.forEach((timer) => window.clearTimeout(timer))
        timers.clear()
        if (window.fetch === measuredFetch) {
          let restored = originalFetch
          while (true) {
            const wrapper = wrappers.get(restored)
            if (!wrapper || wrapper.active()) break
            restored = wrapper.original
          }
          window.fetch = restored
        }
      }
    },
  }
}
