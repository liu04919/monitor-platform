import type { HeartbeatOptions } from './types'

// 只管计时和心跳，不在这里读取 DOM、压缩录屏或发送网络请求。
export class HeartbeatWatchdog {
  private timer?: ReturnType<typeof setInterval>
  private sequence = 0
  private pendingId?: number
  private lastResponseAt = 0
  private lastTickAt = 0
  private reported = false

  constructor(
    private options: Required<HeartbeatOptions>,
    private ping: (id: number) => void,
    private report: (unresponsiveDuration: number) => void,
  ) {}

  setActive(active: boolean): void {
    if (!active) {
      this.stop()
      return
    }
    if (this.timer !== undefined) return
    this.lastResponseAt = performance.now()
    this.lastTickAt = this.lastResponseAt
    this.reported = false
    this.timer = setInterval(() => this.tick(), this.options.intervalMs)
    this.sendPing()
  }

  pong(id: number): void {
    // 暂停前的回复、已过期的回复不能重置当前这一轮检测。
    if (this.pendingId === undefined || id !== this.pendingId) return
    this.pendingId = undefined
    this.lastResponseAt = performance.now()
    this.reported = false
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.pendingId = undefined
  }

  private sendPing(): void {
    this.pendingId = ++this.sequence
    this.ping(this.pendingId)
  }

  private tick(): void {
    const now = performance.now()
    const workerDelay = now - this.lastTickAt
    this.lastTickAt = now

    if (workerDelay >= this.options.timeoutMs) {
      // 连 Worker 自己都停了很久，可能是休眠或冻结。重新询问，不能直接怪主线程。
      this.lastResponseAt = now
    } else if (!this.reported && now - this.lastResponseAt >= this.options.timeoutMs) {
      this.reported = true
      this.report(now - this.lastResponseAt)
    }

    // 上报后仍继续发心跳，收到有效回复后才能检测下一次异常。
    this.sendPing()
  }
}
