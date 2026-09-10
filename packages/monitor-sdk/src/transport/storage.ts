import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ReportTask, TransportOptions } from './types'

interface QueueDatabase extends DBSchema {
  reportQueue: {
    key: string
    value: ReportTask
    indexes: {
      'by-scope-created': [string, number, number]
      'by-scope-due': [string, number]
    }
  }
}

let connection: Promise<IDBPDatabase<QueueDatabase>> | undefined

function database(): Promise<IDBPDatabase<QueueDatabase>> {
  if (!connection) {
    connection = openDB<QueueDatabase>('monitor-sdk', 4, {
      upgrade(db) {
        // 开发项目采用单一队列结构，不保留旧记录的双读/转换路径。
        if (db.objectStoreNames.contains('reportQueue')) db.deleteObjectStore('reportQueue')
        const store = db.createObjectStore('reportQueue', { keyPath: 'id' })
        store.createIndex('by-scope-created', ['scope', 'createdAt', 'bytes'])
        store.createIndex('by-scope-due', ['scope', 'nextRetryAt'])
      },
      blocking() {
        void connection?.then((db) => db.close())
        connection = undefined
      },
      terminated() {
        connection = undefined
      },
    }).catch((error: unknown) => {
      connection = undefined
      throw error
    })
  }
  return connection
}

export class QueueStorage {
  constructor(
    private scope: string,
    private limits: TransportOptions,
  ) {}

  async add(task: ReportTask): Promise<boolean> {
    const db = await database()
    const tx = db.transaction('reportQueue', 'readwrite')
    void tx.done.catch(() => {})
    // 容量检查只读取索引键，不为每次入队反序列化整个离线队列的事件/录屏正文。
    let cursor = await tx.store
      .index('by-scope-created')
      .openKeyCursor(IDBKeyRange.bound([this.scope, 0], [this.scope, Number.MAX_SAFE_INTEGER]))
    let bytes = 0
    let count = 0
    while (cursor) {
      const [, createdAt, taskBytes] = cursor.key
      if (Date.now() - createdAt >= this.limits.maxQueueAgeMs) {
        await tx.store.delete(cursor.primaryKey)
      } else {
        if (cursor.primaryKey === task.id) {
          await tx.done
          return true
        }
        bytes += taskBytes
        count++
      }
      cursor = await cursor.continue()
    }
    const accepted =
      count < this.limits.maxQueueTasks && bytes + task.bytes <= this.limits.maxQueueBytes
    if (accepted) await tx.store.add(task)
    await tx.done
    return accepted
  }

  async claim(owner: string): Promise<ReportTask | undefined> {
    const db = await database()
    const tx = db.transaction('reportQueue', 'readwrite')
    void tx.done.catch(() => {})
    const now = Date.now()
    let cursor = await tx.store
      .index('by-scope-due')
      .openCursor(IDBKeyRange.bound([this.scope, 0], [this.scope, now]))
    let selected: ReportTask | undefined
    while (cursor) {
      const task = cursor.value
      if (now - task.createdAt >= this.limits.maxQueueAgeMs) {
        await tx.store.delete(task.id)
      } else if ((task.leaseUntil ?? 0) <= now) {
        const leaseUntil = now + this.limits.requestTimeoutMs + 5000
        selected = {
          ...task,
          leaseOwner: owner,
          leaseUntil,
          nextRetryAt: leaseUntil,
        }
        await tx.store.put(selected)
        break
      }
      cursor = await cursor.continue()
    }
    await tx.done
    return selected
  }

  async settle(task: ReportTask, retry?: ReportTask): Promise<void> {
    const db = await database()
    const tx = db.transaction('reportQueue', 'readwrite')
    void tx.done.catch(() => {})
    const current = await tx.store.get(task.id)
    // 同一项目的不同标签页使用短租约，旧请求不能覆盖新消费者的结果。
    if (current && current.scope === this.scope && current.leaseOwner === task.leaseOwner) {
      if (retry) await tx.store.put({ ...retry, leaseOwner: undefined, leaseUntil: undefined })
      else await tx.store.delete(task.id)
    }
    await tx.done
  }
}
