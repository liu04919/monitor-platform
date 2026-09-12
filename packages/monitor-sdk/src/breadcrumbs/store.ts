import { sanitizeData } from '../common/sanitize'
import { safely } from '../common/safe'
import type { Breadcrumb } from '../types/events'
import type { BreadcrumbInput, BreadcrumbOptions } from './types'

const MAX_BREADCRUMB_BYTES = 2048
const MAX_TOTAL_BYTES = 32 * 1024
const categories = new Set<Breadcrumb['category']>([
  'click',
  'navigation',
  'http',
  'console',
  'custom',
])

export class BreadcrumbStore {
  private entries: { json: string; bytes: number }[] = []
  private bytes = 0
  private readonly limit: number

  constructor(private readonly options: BreadcrumbOptions = {}) {
    const limit = options.maxBreadcrumbs ?? 25
    this.limit = Number.isFinite(limit) ? Math.min(100, Math.max(0, Math.floor(limit))) : 25
  }

  add(input: BreadcrumbInput): void {
    if (!this.limit) return
    safely(() => {
      let breadcrumb = this.normalize({ ...input, timestamp: input.timestamp ?? Date.now() })
      if (!breadcrumb) return
      if (this.options.beforeBreadcrumb) {
        const filtered = this.options.beforeBreadcrumb(breadcrumb)
        // Hook 是同步契约；误传 async 函数时也不要留下未处理的 rejection。
        if (filtered && typeof (filtered as unknown as PromiseLike<unknown>).then === 'function') {
          safely(() => filtered)
          return
        }
        breadcrumb = filtered && this.normalize(filtered)
      }
      if (!breadcrumb) return
      const json = JSON.stringify(breadcrumb)
      const bytes = new TextEncoder().encode(json).byteLength
      if (bytes > MAX_BREADCRUMB_BYTES) return
      this.entries.push({ json, bytes })
      this.bytes += bytes
      while (this.entries.length > this.limit || this.bytes > MAX_TOTAL_BYTES) {
        this.bytes -= this.entries.shift()!.bytes
      }
    })
  }

  snapshot(): Breadcrumb[] {
    // 从内部序列化快照重建，调用者和后续事件都不能修改已经保存的轨迹。
    return this.entries.map((entry) => JSON.parse(entry.json) as Breadcrumb)
  }

  clear(): void {
    this.entries = []
    this.bytes = 0
  }

  private normalize(input: Breadcrumb): Breadcrumb | null {
    if (!categories.has(input.category) || !Number.isFinite(input.timestamp) || input.timestamp < 0)
      return null
    return {
      category: input.category,
      timestamp: input.timestamp,
      message: typeof input.message === 'string' ? input.message.slice(0, 256) : undefined,
      data: input.data ? sanitizeData(input.data) : undefined,
    }
  }
}
