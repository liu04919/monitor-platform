import type { ReactNode } from 'react'

export type AiStreamKind = 'chat' | 'resume' | 'custom'

export type AiStreamPluginOptions = {
  /** URL 包含数组中的任意字符串即采集；默认 ['/api/chat']，空数组不采集。 */
  urlPatterns?: string[]
  /** 单次等待读取的停顿门槛，默认 2000ms；必须为正有限数字且不超过计时器上限。 */
  stallThreshold?: number
  /** 只传诊断元信息；SDK 复制并过滤常见敏感字段，不采集请求体或回答正文。 */
  getMeta?: (
    url: string,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Record<string, unknown> | undefined
}

export type ReactProfilerOptions = {
  /** 第一条回调后等待多久汇总，默认 1000ms；必须为正有限数字且不超过计时器上限。 */
  reportIntervalMs?: number
  /** 单个 ID 累计多少次提交后提前汇总，默认 20；必须为正安全整数。 */
  maxCommitCount?: number
  /** actualDuration 的慢渲染门槛，默认 16ms；0 表示所有渲染均计入。 */
  slowRenderThresholdMs?: number
}

export type MonitorProfilerProps = {
  id: string
  children: ReactNode
  disabled?: boolean
}

export type AiPerformancePluginOptions = {
  stream?: AiStreamPluginOptions
  reactProfiler?: ReactProfilerOptions
}
