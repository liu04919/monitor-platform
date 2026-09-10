export interface TransportOptions {
  requestTimeoutMs: number
  maxBatchBytes: number
  maxQueueTasks: number
  maxQueueBytes: number
  maxQueueAgeMs: number
  maxRetries: number
}

export type DropReason =
  | 'invalid_event'
  | 'event_too_large'
  | 'queue_full'
  | 'expired'
  | 'retries_exhausted'
  | 'http_rejected'
export interface ReportDrop {
  reason: DropReason
  batchId?: string
  eventId?: string
}

export interface ReportTask {
  id: string
  scope: string
  url: string
  /** 固定序列化结果；重试不能重新生成 batchId、sentAt 或修改事件。 */
  body: string
  bytes: number
  createdAt: number
  retryCount: number
  nextRetryAt: number
  leaseOwner?: string
  leaseUntil?: number
}

export const EXIT_BUDGET_BYTES = 60 * 1024
export const RETRY_CHECK_MS = 1000

export function transportOptions(input: Partial<TransportOptions> = {}): TransportOptions {
  const defaults: TransportOptions = {
    requestTimeoutMs: 10_000,
    maxBatchBytes: 256 * 1024,
    maxQueueTasks: 100,
    maxQueueBytes: 5 * 1024 * 1024,
    maxQueueAgeMs: 24 * 60 * 60 * 1000,
    maxRetries: 5,
  }
  for (const key of Object.keys(defaults) as (keyof TransportOptions)[]) {
    const value = input[key]
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= (key === 'maxRetries' ? 0 : 1)
    ) {
      defaults[key] = Math.floor(value)
    }
  }
  // 给服务端 1 MiB 请求上限留足余量。
  defaults.maxBatchBytes = Math.min(defaults.maxBatchBytes, 900 * 1024, defaults.maxQueueBytes)
  return defaults
}
