import type { Breadcrumb, MonitorEvent } from './events'

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
  getBehaviorState: () => Breadcrumb[]
  getRecordScreenData: () => string
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
  reportBefore?: any
  reportAfter?: any
  reportSuccess?: any
  reportFail?: any
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

export type PageInformation = {
  host: string
  hostname: string
  href: string
  protocol: string
  origin: string
  port: string
  pathname: string
  search: string
  hash: string
  title: string
  language: string
  userAgent?: string
  winScreen: string
  docScreen: string
  pageLoadType: string
}

export type originInfoType = {
  referrer: string
  navigationType: string | number
}

/**
 * rrweb 按时间窗口保存的一段录屏事件。
 */
export type RecordEventScope = {
  scope: string
  eventList: any[]
}
