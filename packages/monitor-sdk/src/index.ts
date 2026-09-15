export { createMonitor, Monitor } from './core'
export type {
  AiEvent,
  BehaviorEvent,
  Breadcrumb,
  BreadcrumbInput,
  BreadcrumbOptions,
  ConfigType,
  ErrorEvent,
  ExceptionErrorEvent,
  MonitorContext,
  MonitorDispose,
  MonitorEvent,
  MonitorPlugin,
  PerformanceEvent,
  ResourceErrorEvent,
  StabilityEvent,
  StackFrame,
  TransportOptions,
  ReportDrop,
} from './types'
export { unzipRecordscreen } from './replay/codec'

export { createMonitor as default } from './core'
