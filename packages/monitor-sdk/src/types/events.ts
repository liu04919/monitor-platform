export const MONITOR_SCHEMA_VERSION = 2 as const

export type EventCategory = 'error' | 'performance' | 'behavior' | 'stability' | 'ai'

export type EventLevel = 'error' | 'warning'

/**
 * 错误堆栈中的一帧。
 *
 * 后端可以直接根据 filename、line、column 展示代码位置，
 * 后续做 Source Map 时也可以继续沿用。
 */
export interface StackFrame {
  filename?: string
  functionName?: string
  line?: number
  column?: number
}

/**
 * 错误发生前的操作轨迹。
 *
 * Breadcrumb 不是完整的行为事件，只是错误上下文的一部分。
 */
export interface Breadcrumb {
  timestamp: number

  category: 'click' | 'navigation' | 'http' | 'console' | 'custom'

  message?: string
  data?: Record<string, unknown>
}

export interface EventBase<Category extends EventCategory, EventType extends string, Payload> {
  schemaVersion: typeof MONITOR_SCHEMA_VERSION

  /**
   * 每发生一次事件都生成一个新的 ID。
   */
  eventId: string

  category: Category
  eventType: EventType

  /**
   * Unix 毫秒时间戳。
   */
  timestamp: number

  pageUrl: string
  userId?: string

  payload: Payload
}

export interface DiagnosticFields {
  breadcrumbs: Breadcrumb[]

  /**
   * 求职项目第一版先直接放压缩后的 rrweb 数据。
   * 项目做大以后可以改成 replayId。
   */
  replayData?: string
}

/* -------------------------------------------------------------------------- */
/*                                    Error                                   */
/* -------------------------------------------------------------------------- */

export type ExceptionEventType =
  | 'js_error'
  | 'unhandled_rejection'
  | 'cors_error'
  | 'react_error'
  | 'vue_error'

export type ErrorMechanismType =
  | 'window.onerror'
  | 'unhandledrejection'
  | 'resource.error'
  | 'react.error_boundary'
  | 'vue.error_handler'

export interface ExceptionInfo {
  name: string
  message: string
  stack: StackFrame[]
}

export interface ErrorMechanism {
  type: ErrorMechanismType
  handled: boolean
}

export interface ExceptionErrorPayload {
  exception: ExceptionInfo
  mechanism: ErrorMechanism

  component?: {
    name?: string
    file?: string
    stack?: string
  }
}

export type ExceptionErrorEvent = EventBase<'error', ExceptionEventType, ExceptionErrorPayload> &
  DiagnosticFields & {
    level: EventLevel
  }

export interface ResourceErrorPayload {
  message: string

  resource: {
    url: string
    tagName?: string
    path?: string
    html?: string
  }

  mechanism: ErrorMechanism
}

export type ResourceErrorEvent = EventBase<'error', 'resource_error', ResourceErrorPayload> &
  DiagnosticFields & {
    level: EventLevel
  }

export type ErrorEvent = ExceptionErrorEvent | ResourceErrorEvent

/* -------------------------------------------------------------------------- */
/*                                 Performance                                */
/* -------------------------------------------------------------------------- */

export type PerformanceEventType =
  | 'web_vital'
  | 'page_load'
  | 'http_request'
  | 'resource_timing'
  | 'react_render'

export interface PerformancePayload {
  /**
   * 例如 FCP、LCP、fetch、xhr、page-load。
   */
  name: string

  value: number

  unit: 'ms' | 'bytes' | 'count'

  /**
   * 只存这一类性能指标特有的数据。
   *
   * 它不是全局万能字段，而是性能事件内部的补充信息。
   */
  attributes?: Record<string, unknown>
}

export type PerformanceEvent = EventBase<'performance', PerformanceEventType, PerformancePayload>

/* -------------------------------------------------------------------------- */
/*                                  Behavior                                  */
/* -------------------------------------------------------------------------- */

export type BehaviorEventType = 'page_view' | 'route_change' | 'click' | 'custom'

export interface BehaviorPayload {
  message?: string
  data?: Record<string, unknown>
}

export type BehaviorEvent = EventBase<'behavior', BehaviorEventType, BehaviorPayload>

/* -------------------------------------------------------------------------- */
/*                                  Stability                                 */
/* -------------------------------------------------------------------------- */

export type StabilityEventType = 'white_screen' | 'stutter' | 'crash'

export interface StabilityPayload {
  message: string
  metrics?: Record<string, number>
}

export type StabilityEvent = EventBase<'stability', StabilityEventType, StabilityPayload> &
  DiagnosticFields & {
    level: EventLevel
  }

/* -------------------------------------------------------------------------- */
/*                                     AI                                     */
/* -------------------------------------------------------------------------- */

export type AiEventType = 'stream_metric' | 'stream_stall'

export interface AiPayload {
  name: string
  value: number
  unit: 'ms' | 'bytes' | 'count'
  attributes?: Record<string, unknown>
}

export type AiEvent = EventBase<'ai', AiEventType, AiPayload>

export type MonitorEvent = ErrorEvent | PerformanceEvent | BehaviorEvent | StabilityEvent | AiEvent
