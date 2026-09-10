import { withSendType } from './batch'
import type { ReportTask } from './types'

// 模块加载时保存原始 Fetch，SDK 传输不经过后来安装的性能采集器。
const nativeFetch = globalThis.fetch?.bind(globalThis)

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Telemetry HTTP ${status}`)
  }
}

export function retryable(error: unknown): boolean {
  return (
    !(error instanceof HttpError) ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  )
}

export class Sender {
  private controllers = new Set<AbortController>()
  constructor(
    private timeoutMs: number,
    private fetcher: typeof fetch | undefined = nativeFetch,
  ) {}

  async send(task: ReportTask, keepalive = false): Promise<void> {
    const controller = new AbortController()
    this.controllers.add(controller)
    let timer: ReturnType<typeof setTimeout> | undefined
    let abortListener: (() => void) | undefined
    try {
      if (!this.fetcher) throw new Error('Fetch unavailable')
      const interrupted = new Promise<never>((_, reject) => {
        abortListener = () => reject(new Error('Telemetry request aborted'))
        controller.signal.addEventListener('abort', abortListener, { once: true })
        timer = setTimeout(() => controller.abort(), this.timeoutMs)
      })
      const response = await Promise.race([
        this.fetcher(task.url, {
          method: 'POST',
          // 退出 fallback 同样采用简单请求，避免在卸载阶段新发起预检。
          headers: { 'Content-Type': keepalive ? 'text/plain;charset=UTF-8' : 'application/json' },
          body: withSendType(task.body, 'fetch'),
          keepalive,
          signal: controller.signal,
        }),
        interrupted,
      ])
      if (!response.ok) throw new HttpError(response.status)
    } finally {
      clearTimeout(timer)
      if (abortListener) controller.signal.removeEventListener('abort', abortListener)
      this.controllers.delete(controller)
    }
  }

  beacon(task: ReportTask): boolean {
    try {
      return (
        navigator.sendBeacon?.(
          task.url,
          new Blob([withSendType(task.body, 'beacon')], {
            type: 'text/plain;charset=UTF-8',
          }),
        ) ?? false
      )
    } catch {
      return false
    }
  }

  abort(): void {
    this.controllers.forEach((controller) => controller.abort())
  }
}
