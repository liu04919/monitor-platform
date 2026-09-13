import type { MonitorPlugin } from '../types'
import { aiStreamPlugin } from './stream'
import { reactProfilerPlugin } from './reactProfiler'
import type { AiPerformancePluginOptions } from './types'
import type { AiEvent, PerformanceEvent } from '../types'
export { aiStreamPlugin, reactProfilerPlugin }
export { createMonitorProfiler, REACT_PROFILER_CAPABILITY } from './reactProfiler'
export type {
  AiPerformancePluginOptions,
  AiStreamPluginOptions,
  MonitorProfilerProps,
  ReactProfilerOptions,
} from './types'
export type AiStreamMetric = AiEvent & {
  eventType: 'stream_metric'
}

export type StreamStallMetric = AiEvent & {
  eventType: 'stream_stall'
}

export type ReactProfilerMetric = PerformanceEvent & {
  eventType: 'react_render'
}

export function aiPerformancePlugins(options: AiPerformancePluginOptions = {}): MonitorPlugin[] {
  return [aiStreamPlugin(options.stream), reactProfilerPlugin(options.reactProfiler)]
}
