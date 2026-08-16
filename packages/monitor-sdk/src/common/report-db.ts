import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { MonitorEvent } from '../types'

export interface ReportPayload {
  schemaVersion: 2

  batchId: string
  sentAt: number
  publicKey: string

  app: {
    id: string
    name: string
  }

  events: MonitorEvent[]
}

export interface ReportTask {
  /**
   * 和 batchId 保持一致，作为 IndexedDB 主键。
   */
  id: string

  /**
   * 任务创建时的上报地址。
   * 避免用户后续修改 config.url，导致旧任务发到错误地址。
   */
  url: string

  payload: ReportPayload

  createdAt: number
  retryCount: number
  nextRetryAt: number
}

interface MonitorReportDB extends DBSchema {
  reportQueue: {
    key: string
    value: ReportTask
    indexes: {
      'by-next-retry-at': number
      'by-created-at': number
    }
  }
}

const DATABASE_NAME = 'monitor-sdk'
const DATABASE_VERSION = 3
const STORE_NAME = 'reportQueue'

let databasePromise: Promise<IDBPDatabase<MonitorReportDB>> | null = null

function getDatabase(): Promise<IDBPDatabase<MonitorReportDB>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not supported in the current environment'))
  }

  if (!databasePromise) {
    databasePromise = openDB<MonitorReportDB>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, {
            keyPath: 'id',
          })

          store.createIndex('by-next-retry-at', 'nextRetryAt')

          store.createIndex('by-created-at', 'createdAt')

          return
        }

        /**
         * 学习项目直接清理旧协议遗留的离线批次：
         *
         * - v1 使用旧 data[]；
         * - v2 批次还没有 publicKey。
         *
         * 防止升级后的 SDK 继续发送不符合当前契约的历史任务。
         */
        if (oldVersion < 3) {
          transaction.objectStore(STORE_NAME).clear()
        }
      },
    })
  }

  return databasePromise
}

/**
 * 第一次创建任务时使用 add。
 * 如果主键重复，add 会抛出异常。
 */
export async function addReportTask(task: ReportTask): Promise<void> {
  const database = await getDatabase()
  await database.add(STORE_NAME, task)
}

/**
 * 更新 retryCount、nextRetryAt 等字段时使用 put。
 */
export async function putReportTask(task: ReportTask): Promise<void> {
  const database = await getDatabase()
  await database.put(STORE_NAME, task)
}

export async function deleteReportTask(taskId: string): Promise<void> {
  const database = await getDatabase()
  await database.delete(STORE_NAME, taskId)
}

/**
 * 获取已经到达重试时间的任务。
 */
export async function getDueReportTasks(now = Date.now(), limit = 20): Promise<ReportTask[]> {
  const database = await getDatabase()

  return database.getAllFromIndex(
    STORE_NAME,
    'by-next-retry-at',
    IDBKeyRange.upperBound(now),
    limit,
  )
}

/**
 * 获取下一个重试时间。
 */
export async function getNextRetryAt(): Promise<number | null> {
  const database = await getDatabase()

  const transaction = database.transaction(STORE_NAME, 'readonly')

  const index = transaction.store.index('by-next-retry-at')

  const cursor = await index.openCursor()

  await transaction.done

  return cursor?.value.nextRetryAt ?? null
}
