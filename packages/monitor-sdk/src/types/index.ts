import type { Breadcrumb, MonitorEvent } from './events'
import type { ReportDrop, TransportOptions } from '../transport/types'
import type { BreadcrumbInput, BreadcrumbOptions } from '../breadcrumbs/types'
export type { BreadcrumbInput, BreadcrumbOptions } from '../breadcrumbs/types'

export type { ReportDrop, TransportOptions } from '../transport/types'

export * from './events'

export type MonitorDispose = () => void

export type MonitorEventHandler<T = any> = (payload: T) => void

export type MonitorEvents = {
  on: <T = any>(name: string, handler: MonitorEventHandler<T>) => MonitorDispose
  off: <T = any>(name: string, handler: MonitorEventHandler<T>) => void
  emit: <T = any>(name: string, payload: T) => void
}

export type MonitorContext = {
  config: ConfigType
  getConfig: () => ConfigType
  report: (event: MonitorEvent) => void
  getPlugin: (name: string) => MonitorPlugin | undefined
  events: MonitorEvents
  provide: <T = unknown>(name: string, value: T) => void
  consume: <T = unknown>(name: string) => T | undefined
  addBreadcrumb: (breadcrumb: BreadcrumbInput) => void
  getBreadcrumbs: () => Breadcrumb[]
  getReplayData: () => string
  on: (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => MonitorDispose
  addDispose: (dispose: MonitorDispose) => MonitorDispose
}

export type MonitorPlugin = {
  name: string
  deps?: string[]
  setup: (context: MonitorContext) => void | MonitorDispose
}

export type ConfigType = {
  url: string
  projectName: string
  appId: string
  publicKey: string
  userId: string
  batchSize: number
  isAjax: boolean
  containerElements: string[]
  skeletonElements: string[]
  transport?: Partial<TransportOptions>
  breadcrumbs?: BreadcrumbOptions
  reportBefore?: (events: MonitorEvent[]) => unknown
  reportAfter?: (events: MonitorEvent[]) => unknown
  reportSuccess?: (events: MonitorEvent[]) => unknown
  reportFail?: (events: MonitorEvent[]) => unknown
  reportDrop?: (info: ReportDrop) => unknown
  plugins?: MonitorPlugin[]
  [key: string]: string | boolean | number | string[] | any
}

/**
 * 浏览器资源加载失败时，event.target 上可能提供的字段。
 */
export type ResourceErrorTarget = {
  src?: string
  href?: string
  tagName?: string
  outerHTML?: string
}
