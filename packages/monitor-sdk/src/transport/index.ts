import { createEventId } from '../common/event'
import { safely } from '../common/safe'
import type { ConfigType, MonitorEvent } from '../types'
import { createBatch, scopeFor } from './batch'
import { ReportQueue } from './queue'
import { retryable, Sender } from './request'
import { QueueStorage } from './storage'
import {
  EXIT_BUDGET_BYTES,
  RETRY_CHECK_MS,
  transportOptions,
  type ReportDrop,
  type ReportTask,
} from './types'

export class ReportTransport {
  private readonly limits
  private readonly queue
  private readonly sender
  private readonly owner = createEventId()
  private events: MonitorEvent[] = []
  private flushTimer?: ReturnType<typeof setTimeout>
  private retryTimer?: ReturnType<typeof setInterval>
  private draining?: Promise<void>
  private stopped = false
  private exitUsed = false
  private revision = 0

  constructor(private config: ConfigType) {
    this.limits = transportOptions(config.transport)
    this.sender = new Sender(this.limits.requestTimeoutMs)
    this.queue = new ReportQueue(
      new QueueStorage(scopeFor(config), this.limits),
      this.limits,
      this.drop,
    )
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.resume)
      window.addEventListener('pagehide', this.exit)
      document.addEventListener('visibilitychange', this.visibility)
    }
    // Window 和 Worker 都需要消费队列；只有页面监听器依赖 window/document。
    if (typeof self !== 'undefined') {
      this.retryTimer = setInterval(this.resume, RETRY_CHECK_MS)
      this.resume()
    }
  }

  report(event: MonitorEvent): void {
    if (this.stopped) return
    try {
      // 接收时就快照；业务后续修改对象，不影响批次身份或异步序列化。
      const snapshot = JSON.parse(JSON.stringify(event)) as MonitorEvent
      if (createBatch(this.config, [snapshot]).bytes > this.limits.maxBatchBytes) {
        this.drop({ reason: 'event_too_large', eventId: event.eventId })
        return
      }
      if (
        this.events.length &&
        createBatch(this.config, [...this.events, snapshot]).bytes > this.limits.maxBatchBytes
      ) {
        this.seal()
      }
      this.events.push(snapshot)
      const batchSize = Number.isFinite(this.config.batchSize)
        ? Math.min(100, Math.max(1, this.config.batchSize))
        : 5
      if (this.events.length >= batchSize) {
        this.seal()
        this.resume()
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          void this.flush()
        }, 1000)
      }
    } catch {
      this.drop({ reason: 'invalid_event', eventId: event?.eventId })
    }
  }

  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    this.seal()
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = undefined
      })
    }
    return this.draining
  }

  destroy(): void {
    if (this.stopped) return
    // 销毁保留待发送批次，但停止网络、回调及定时器；需要确认发送时先 await flush()。
    this.stopped = true
    this.seal()
    clearInterval(this.retryTimer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.resume)
      window.removeEventListener('pagehide', this.exit)
      document.removeEventListener('visibilitychange', this.visibility)
    }
    this.sender.abort()
    void this.queue.persist()
  }

  private drop = (info: ReportDrop): void => {
    if (!this.stopped) safely(() => this.config.reportDrop?.(info))
  }

  private callback(
    name: 'reportBefore' | 'reportAfter' | 'reportSuccess' | 'reportFail',
    task: ReportTask,
  ): void {
    if (!this.stopped)
      safely(() => this.config[name]?.(JSON.parse(task.body).events as MonitorEvent[]))
  }

  private seal(exit = false): ReportTask | undefined {
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    if (!this.events.length) return
    const task = createBatch(this.config, this.events)
    this.events = []
    if (exit) task.nextRetryAt = Date.now() + this.limits.requestTimeoutMs + 5000
    this.callback('reportBefore', task)
    if (!this.queue.add(task)) return
    this.revision++
    return task
  }

  private resume = (): void => {
    if (!this.stopped && this.canSend()) void this.flush()
  }

  private canSend(): boolean {
    return (
      (typeof document === 'undefined' || !document.hidden) &&
      (typeof navigator === 'undefined' || navigator.onLine !== false)
    )
  }

  private visibility = (): void => {
    if (document.hidden) this.exit()
    else {
      this.exitUsed = false
      this.resume()
    }
  }

  private exit = (): void => {
    if (this.stopped) return
    const task = this.seal(true)
    // 同一隐藏周期最多尝试一个小批次，visibilitychange/pagehide 不重复发送。
    if (!task || this.exitUsed || task.bytes > EXIT_BUDGET_BYTES) return
    this.exitUsed = true
    if (this.sender.beacon(task)) {
      // true 只是浏览器接受发送，不能删除持久化记录或通知 reportSuccess。
      this.callback('reportAfter', task)
    } else {
      void this.sendExit(task)
    }
  }

  private async sendExit(task: ReportTask): Promise<void> {
    let failure: { error: unknown } | undefined
    try {
      await this.sender.send(task, true)
    } catch (error) {
      failure = { error }
    }
    await this.queue.persist()
    await this.complete(task, failure)
  }

  private async drain(): Promise<void> {
    // 所有正常发送走同一个串行消费者，新事件和离线重传不争抢连接。
    while (!this.stopped && this.canSend()) {
      const revision = this.revision
      const task = await this.queue.next(this.owner)
      if (!task) {
        if (revision !== this.revision) continue
        return
      }
      if (this.stopped || !this.canSend()) {
        await this.queue.settle(task, { ...task, nextRetryAt: Date.now() })
        return
      }
      let failure: { error: unknown } | undefined
      try {
        await this.sender.send(task)
      } catch (error) {
        failure = { error }
      }
      await this.complete(task, failure)
    }
  }

  private async complete(task: ReportTask, failure: { error: unknown } | undefined): Promise<void> {
    if (this.stopped) {
      await this.queue.settle(task, { ...task, nextRetryAt: Date.now() })
      void this.queue.persist()
      return
    }
    if (failure === undefined) {
      await this.queue.settle(task)
      this.callback('reportSuccess', task)
    } else {
      const count = task.retryCount + 1
      if (retryable(failure.error) && count <= this.limits.maxRetries) {
        const delay = Math.min(60_000, 1000 * 2 ** (count - 1)) * (0.5 + Math.random() / 2)
        await this.queue.settle(task, {
          ...task,
          retryCount: count,
          nextRetryAt: Date.now() + delay,
        })
      } else {
        await this.queue.settle(task)
        this.drop({
          reason: retryable(failure.error) ? 'retries_exhausted' : 'http_rejected',
          batchId: task.id,
        })
      }
      this.callback('reportFail', task)
    }
    this.callback('reportAfter', task)
  }
}
