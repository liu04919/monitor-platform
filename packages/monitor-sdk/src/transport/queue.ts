import { QueueStorage } from './storage'
import type { ReportDrop, ReportTask, TransportOptions } from './types'

export class ReportQueue {
  private pending = new Map<string, ReportTask>()
  private saving?: Promise<void>
  private writing?: string
  private storageFailed = false

  constructor(
    private storage: QueueStorage,
    private limits: TransportOptions,
    private drop: (info: ReportDrop) => void,
  ) {}

  add(task: ReportTask): boolean {
    this.expire()
    const bytes = [...this.pending.values()].reduce((sum, item) => sum + item.bytes, 0)
    if (
      this.pending.size >= this.limits.maxQueueTasks ||
      bytes + task.bytes > this.limits.maxQueueBytes
    ) {
      this.drop({ reason: 'queue_full', batchId: task.id })
      return false
    }
    this.pending.set(task.id, task)
    void this.persist()
    return true
  }

  persist(): Promise<void> {
    if (this.saving) return this.saving
    this.saving = this.savePending().finally(() => {
      this.saving = undefined
      if (!this.storageFailed && [...this.pending.values()].some((task) => !task.leaseOwner)) {
        void this.persist()
      }
    })
    return this.saving
  }

  private async savePending(): Promise<void> {
    this.expire()
    // 只保留一个写入协程。高频事件不能堆出无上限的待执行 Promise。
    // 每轮只处理固定快照，持续产生新事件时也要给发送器让出执行机会。
    for (const id of [...this.pending.keys()]) {
      const task = this.pending.get(id)
      if (!task || task.leaseOwner) continue
      try {
        this.writing = task.id
        const accepted = await this.storage.add(task)
        this.storageFailed = false
        if (this.pending.get(task.id) === task) this.pending.delete(task.id)
        if (!accepted) this.drop({ reason: 'queue_full', batchId: task.id })
      } catch {
        this.storageFailed = true
        // IndexedDB 不可用时保留完整批次，而不是拆回事件、重新生成 batchId。
        break
      } finally {
        this.writing = undefined
      }
    }
  }

  async next(owner: string): Promise<ReportTask | undefined> {
    await this.persist()
    try {
      const task = await this.storage.claim(owner)
      if (task) return task
    } catch {
      /* 浏览器存储失败时，继续消费有界内存队列。 */
    }
    this.expire()
    // 写入中的任务不能同时被内存消费者取走，否则会在磁盘和内存各发送一次。
    const task = this.storageFailed
      ? [...this.pending.values()].find(
          (item) => item.id !== this.writing && !item.leaseOwner && item.nextRetryAt <= Date.now(),
        )
      : undefined
    if (task) {
      const claimed = { ...task, leaseOwner: owner }
      this.pending.set(task.id, claimed)
      return claimed
    }
  }

  async settle(task: ReportTask, retry?: ReportTask): Promise<void> {
    if (this.pending.has(task.id)) {
      if (retry)
        this.pending.set(task.id, { ...retry, leaseOwner: undefined, leaseUntil: undefined })
      else this.pending.delete(task.id)
      return
    }
    try {
      await this.storage.settle(task, retry)
    } catch {
      // 已持久化任务保留原 ID；删除/更新失败后，租约到期可重新确认服务端结果。
    }
  }

  private expire(): void {
    for (const task of this.pending.values()) {
      if (!task.leaseOwner && Date.now() - task.createdAt >= this.limits.maxQueueAgeMs) {
        this.pending.delete(task.id)
        this.drop({ reason: 'expired', batchId: task.id })
      }
    }
  }
}
