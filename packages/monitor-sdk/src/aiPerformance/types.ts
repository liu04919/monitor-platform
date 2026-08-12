import type { ReactNode } from 'react'

export type AiStreamUrlMatcher =
  | string
  | RegExp
  | ((url: string, input: RequestInfo | URL, init?: RequestInit) => boolean)

export type AiStreamKind = 'chat' | 'resume' | 'custom'

export type AiStreamPluginOptions = {
  urlPatterns?: AiStreamUrlMatcher[]
  stallThreshold?: number
  getMeta?: (
    url: string,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Record<string, any> | undefined
}

export type ReactProfilerOptions = {
  reportInterval?: number
  maxCommitCount?: number
  slowCommitThreshold?: number
}

export type MonitorProfilerProps = {
  id: string
  children: ReactNode
  disabled?: boolean
}

export type StallPluginOptions = {
  longTaskThreshold?: number
  rafGapThreshold?: number
  reportInterval?: number
}

export type AiPerformancePluginOptions = {
  stream?: AiStreamPluginOptions
  reactProfiler?: ReactProfilerOptions
  stall?: StallPluginOptions
}
