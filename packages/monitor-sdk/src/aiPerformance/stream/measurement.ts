import { createEventBase } from '../../common/event'
import { safely } from '../../common/safe'
import type { AiEvent, MonitorContext } from '../../types'
import type { AiStreamKind } from '../types'

type StreamRequest = {
  url: string
  method: string
  pageUrl: string
  requestStart: number
  meta?: Record<string, unknown>
  signal?: AbortSignal | null
}

type EndReason = 'end' | 'error' | 'cancel'
export type StreamMeasurement = ReturnType<typeof createStreamMeasurement>

function getStreamKind(url: string): AiStreamKind {
  const pathname = new URL(url, window.location.href).pathname
  if (/\/api\/chat\/[^/]+\/stream$/.test(pathname)) return 'resume'
  if (pathname.includes('/api/chat')) return 'chat'
  return 'custom'
}

// 只负责统计和上报，不读取、取消或保存业务数据。
export function createStreamMeasurement(
  ctx: MonitorContext,
  request: StreamRequest,
  stallThreshold: number,
  timers: Set<number>,
  isActive: () => boolean,
) {
  const traceId = `ai-stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  let status = 0
  let responseStart: number | undefined
  let firstChunkTime: number | undefined
  let lastChunkTime: number | undefined
  let chunkCount = 0
  let totalBytes = 0
  let maxChunkInterval = 0
  let timer: number | undefined
  let finished = false

  function report(
    eventType: AiEvent['eventType'],
    value: number,
    attributes: Record<string, unknown>,
  ) {
    if (!isActive()) return
    safely(() =>
      ctx.report({
        ...createEventBase(ctx),
        pageUrl: request.pageUrl,
        category: 'ai',
        eventType,
        payload: {
          name: eventType === 'stream_metric' ? 'ai-stream' : 'ai-stream-stall',
          value,
          unit: 'ms',
          attributes: {
            traceId,
            url: request.url,
            method: request.method,
            ...attributes,
            meta: request.meta,
          },
        },
      }),
    )
  }

  function stopWaiting() {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.delete(timer)
    }
    timer = undefined
  }

  function dispose() {
    if (finished) return
    finished = true
    stopWaiting()
  }

  return {
    dispose,
    stopWaiting,
    responseStarted(response: Response) {
      if (finished || !isActive()) return
      responseStart = performance.now()
      status = response.status
    },
    chunk(value: Uint8Array) {
      if (finished || !isActive()) return
      const now = performance.now()
      if (firstChunkTime === undefined) firstChunkTime = now
      if (lastChunkTime !== undefined)
        maxChunkInterval = Math.max(maxChunkInterval, now - lastChunkTime)
      lastChunkTime = now
      chunkCount++
      totalBytes += value.byteLength
    },
    startWaiting() {
      if (finished || !isActive()) return
      stopWaiting()
      // 从本次 read 开始计时，不把业务处理上一块数据的时间算成等待。
      const waitStart = performance.now()
      const timerId = window.setTimeout(() => {
        timers.delete(timerId)
        timer = undefined
        if (finished || !isActive()) return
        report('stream_stall', performance.now() - waitStart, {
          threshold: stallThreshold,
          chunkCount,
          waitStart,
        })
        // 同一个 pending read 只报告一次；下一次 read 再开启新的检测。
      }, stallThreshold)
      timer = timerId
      timers.add(timerId)
    },
    finish(reason: EndReason, error?: unknown) {
      if (finished) return
      dispose()
      if (!isActive()) return
      const streamEndTime = performance.now()
      const ttlb = streamEndTime - request.requestStart
      const endReason = reason === 'error' && request.signal?.aborted ? 'cancel' : reason
      let errorMessage: string | undefined
      // 任意 cancel reason 的 toString 也可能抛错。
      safely(() => {
        if (error !== undefined)
          errorMessage = String(error instanceof Error ? error.message : error).slice(0, 256)
      })
      let averageChunkInterval: number | undefined
      if (chunkCount > 1 && firstChunkTime !== undefined && lastChunkTime !== undefined) {
        averageChunkInterval = (lastChunkTime - firstChunkTime) / (chunkCount - 1)
      }
      report('stream_metric', ttlb, {
        streamKind: getStreamKind(request.url),
        status,
        success: endReason === 'end' && status >= 200 && status < 300,
        endReason,
        requestStart: request.requestStart,
        responseStart,
        firstChunkTime,
        lastChunkTime,
        streamEndTime,
        // 用 Fetch 返回时刻近似首字节到达，用首 / 尾 chunk 近似首 / 尾 token 到达。
        // 未解析模型协议；浏览器缓冲和业务读取速度会影响这些毫秒值。
        ttfb: responseStart === undefined ? undefined : responseStart - request.requestStart,
        ttft: firstChunkTime === undefined ? undefined : firstChunkTime - request.requestStart,
        ttlt: lastChunkTime === undefined ? undefined : lastChunkTime - request.requestStart,
        // 正常结束表示读取完成；取消或报错时表示截至中断的耗时，结合 endReason 判断。
        ttlb,
        chunkCount,
        totalBytes,
        averageChunkInterval,
        maxChunkInterval: chunkCount > 1 ? maxChunkInterval : undefined,
        errorMessage,
      })
    },
  }
}
