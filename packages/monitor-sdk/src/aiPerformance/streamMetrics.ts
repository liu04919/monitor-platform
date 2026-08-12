import { createEventBase } from '../common/event'
import type { AiEvent, MonitorContext, MonitorPlugin } from '../types'
import type { AiStreamPluginOptions } from './types'
import {
  createTraceId,
  getByteLength,
  getRequestMethod,
  getRequestUrl,
  getStreamKind,
  isReportUrl,
  shouldTrackAiStream,
} from './utils'

const DEFAULT_STALL_THRESHOLD = 2000
const DEFAULT_URL_PATTERNS = ['/api/chat']

type StreamState = {
  traceId: string
  url: string
  method: string
  pageUrl: string
  meta?: Record<string, any>

  requestStart: number
  responseStart: number
  firstChunkTime: number
  lastChunkTime: number
  streamEndTime: number

  chunkCount: number
  totalBytes: number
  maxChunkInterval: number

  stallTimer: number | null
  stallReportedAt: number
  finished: boolean
}

export function aiStreamPlugin(options: AiStreamPluginOptions = {}): MonitorPlugin {
  return {
    name: 'ai-performance:stream',

    setup(ctx: MonitorContext) {
      if (typeof window.fetch !== 'function') {
        return () => {}
      }

      const originalFetch = window.fetch
      const urlPatterns = options.urlPatterns ?? DEFAULT_URL_PATTERNS
      const stallThreshold = options.stallThreshold ?? DEFAULT_STALL_THRESHOLD

      const measuredFetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = getRequestUrl(input)
        const config = ctx.getConfig()

        // 监控上报请求以及非 AI 流式请求，直接走原始 fetch。
        if (isReportUrl(url, config.url) || !shouldTrackAiStream(url, input, init, urlPatterns)) {
          return originalFetch.call(window, input, init)
        }

        const state: StreamState = {
          traceId: createTraceId('ai-stream'),
          url,
          method: getRequestMethod(input, init),
          pageUrl: window.location.href,
          meta: options.getMeta?.(url, input, init),

          requestStart: performance.now(),
          responseStart: 0,
          firstChunkTime: 0,
          lastChunkTime: 0,
          streamEndTime: 0,

          chunkCount: 0,
          totalBytes: 0,
          maxChunkInterval: 0,

          stallTimer: null,
          stallReportedAt: 0,
          finished: false,
        }

        let responseStatus = 0

        /**
         * 统一结束逻辑。
         *
         * 以下情况最终都会进入这里：
         * 1. 流正常读取结束
         * 2. 流读取报错
         * 3. 用户主动取消
         * 4. fetch 本身失败
         */
        const finish = (success: boolean, error?: unknown): void => {
          if (state.finished) {
            return
          }

          state.finished = true
          state.streamEndTime = performance.now()

          if (state.stallTimer !== null) {
            clearTimeout(state.stallTimer)
            state.stallTimer = null
          }

          const firstChunkTime = state.firstChunkTime
          const lastChunkTime = state.lastChunkTime || state.streamEndTime

          const chunkIntervalCount = Math.max(state.chunkCount - 1, 0)

          const averageChunkInterval =
            chunkIntervalCount > 0 ? (lastChunkTime - firstChunkTime) / chunkIntervalCount : 0

          const ttlb = state.streamEndTime - state.requestStart

          const errorMessage =
            error === undefined ? undefined : error instanceof Error ? error.message : String(error)

          const metric: AiEvent = {
            ...createEventBase(ctx),

            /**
             * 保留请求发起时的页面，
             * 防止流式响应期间用户切换路由。
             */
            pageUrl: state.pageUrl,

            category: 'ai',
            eventType: 'stream_metric',

            payload: {
              name: 'ai-stream',
              value: ttlb,
              unit: 'ms',

              attributes: {
                traceId: state.traceId,
                streamKind: getStreamKind(state.url),
                url: state.url,
                method: state.method,
                status: responseStatus,
                success,

                requestStart: state.requestStart,
                responseStart: state.responseStart,
                firstChunkTime,
                lastChunkTime,
                streamEndTime: state.streamEndTime,

                ttfb: state.responseStart ? state.responseStart - state.requestStart : 0,

                ttft: firstChunkTime ? firstChunkTime - state.requestStart : 0,

                ttlt: state.chunkCount ? lastChunkTime - state.requestStart : 0,

                ttlb,

                chunkCount: state.chunkCount,
                totalBytes: state.totalBytes,
                averageChunkInterval,
                maxChunkInterval: state.maxChunkInterval,

                errorMessage,
                meta: state.meta,
              },
            },
          }

          ctx.report(metric)
        }

        /**
         * 每收到一个 chunk，就重新开始倒计时。
         *
         * 如果 threshold 时间内没有新 chunk：
         * 1. 上报一次卡顿
         * 2. 继续计时
         *
         * 因此持续卡顿时，每隔 threshold 会再次上报。
         */
        const armStallTimer = (): void => {
          if (state.finished) {
            return
          }

          if (state.stallTimer !== null) {
            clearTimeout(state.stallTimer)
          }

          state.stallTimer = window.setTimeout(() => {
            if (state.finished) {
              return
            }

            const now = performance.now()

            // 有 chunk 就从最后一个 chunk 开始计算；
            // 没有 chunk 就从响应头返回开始计算。
            const since = state.lastChunkTime || state.responseStart || state.requestStart

            const duration = now - since

            if (now - state.stallReportedAt >= stallThreshold) {
              state.stallReportedAt = now

              const stallMetric: AiEvent = {
                ...createEventBase(ctx),
                pageUrl: state.pageUrl,

                category: 'ai',
                eventType: 'stream_stall',

                payload: {
                  name: 'ai-stream-stall',
                  value: duration,
                  unit: 'ms',

                  attributes: {
                    traceId: state.traceId,
                    url: state.url,
                    method: state.method,
                    threshold: stallThreshold,
                    chunkCount: state.chunkCount,
                    since,
                    meta: state.meta,
                  },
                },
              }

              ctx.report(stallMetric)
            }

            // 如果流还没有结束，继续检测下一段卡顿。
            armStallTimer()
          }, stallThreshold)
        }

        try {
          const response = await originalFetch.call(window, input, init)

          state.responseStart = performance.now()
          responseStatus = response.status

          // 没有响应体，例如 204、HEAD 请求。
          if (!response.body) {
            finish(response.ok)
            return response
          }

          /**
           * pipeThrough 只负责旁路统计 chunk。
           *
           * chunk 本身不做修改，统计完成后原样传给业务代码。
           */
          const measuredBody = response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                const now = performance.now()

                if (!state.firstChunkTime) {
                  state.firstChunkTime = now
                }

                if (state.lastChunkTime) {
                  state.maxChunkInterval = Math.max(
                    state.maxChunkInterval,
                    now - state.lastChunkTime,
                  )
                }

                state.lastChunkTime = now
                state.chunkCount++
                state.totalBytes += getByteLength(chunk)

                // 收到新 chunk 后，重新开始检测卡顿。
                armStallTimer()

                // 不修改业务数据。
                controller.enqueue(chunk)
              },
            }),
          )

          const reader = measuredBody.getReader()
          let readingStarted = false

          /**
           * 外层 ReadableStream 只负责流生命周期：
           *
           * done   → 正常结束
           * catch  → 流读取异常
           * cancel → 用户主动取消
           */
          const lifecycleBody = new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (!readingStarted) {
                readingStarted = true
                armStallTimer()
              }

              try {
                const { done, value } = await reader.read()

                if (done) {
                  finish(response.ok)
                  controller.close()
                  return
                }

                controller.enqueue(value)
              } catch (error) {
                finish(false, error)
                controller.error(error)
              }
            },

            cancel(reason) {
              finish(false, reason || new Error('stream canceled'))

              return reader.cancel(reason)
            },
          })

          return new Response(lifecycleBody, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        } catch (error) {
          /*
           * fetch 本身失败时，没有真正拿到 Response，
           * 所以 status 和 ttfb 都保持为 0。
           */
          finish(false, error)
          throw error
        }
      }

      window.fetch = measuredFetch

      return () => {
        if (window.fetch === measuredFetch) {
          window.fetch = originalFetch
        }
      }
    },
  }
}
