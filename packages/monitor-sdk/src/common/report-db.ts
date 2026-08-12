import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { MonitorEvent } from '../types'

export interface ReportPayload {
  schemaVersion: 2

  batchId: string
  sentAt: number

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
const DATABASE_VERSION = 2
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
         * 学习项目直接清理 v1 遗留的离线批次，
         * 防止旧 data[] 被发送给 v2 后端。
         */
        if (oldVersion < 2) {
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
