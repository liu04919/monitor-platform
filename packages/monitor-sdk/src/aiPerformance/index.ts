import type { MonitorPlugin } from '../types'
import { aiStreamPlugin } from './streamMetrics'
import { reactProfilerPlugin } from './reactProfiler'
import { stallPlugin } from './stall'
import type { AiPerformancePluginOptions } from './types'
import type { AiEvent, PerformanceEvent, StabilityEvent } from '../types'
export { aiStreamPlugin, reactProfilerPlugin, stallPlugin }
export { createMonitorProfiler, REACT_PROFILER_CAPABILITY } from './reactProfiler'
export type {
  AiPerformancePluginOptions,
  AiStreamPluginOptions,
  AiStreamUrlMatcher,
  MonitorProfilerProps,
  ReactProfilerOptions,
  StallPluginOptions,
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

export type StallMetric = StabilityEvent & {
  eventType: 'stutter'
}
export function aiPerformancePlugins(options: AiPerformancePluginOptions = {}): MonitorPlugin[] {
  return [
    aiStreamPlugin(options.stream),
    reactProfilerPlugin(options.reactProfiler),
    stallPlugin(options.stall),
  ]
}
