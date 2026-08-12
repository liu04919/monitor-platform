import { Profiler } from 'react'
import type { ProfilerOnRenderCallback } from 'react'
import { createEventBase } from '../common/event'
import type { MonitorContext, MonitorPlugin, PerformanceEvent } from '../types'
import type { MonitorProfilerProps, ReactProfilerOptions } from './types'

const DEFAULT_REPORT_INTERVAL = 1000
const DEFAULT_MAX_COMMIT_COUNT = 20
const DEFAULT_SLOW_COMMIT_THRESHOLD = 16
export const REACT_PROFILER_CAPABILITY = 'ai-performance:react-profiler'

type ProfilerStats = {
  windowStart: number
  commitCount: number
  mountCount: number
  updateCount: number
  nestedUpdateCount: number
  actualDurationTotal: number
  actualDurationMax: number
  baseDurationMax: number
  slowCommitCount: number
  lastPhase: string
  lastStartTime: number
  lastCommitTime: number
  timer: number | null
}

function createEmptyStats(): ProfilerStats {
  return {
    windowStart: performance.now(),
    commitCount: 0,
    mountCount: 0,
    updateCount: 0,
    nestedUpdateCount: 0,
    actualDurationTotal: 0,
    actualDurationMax: 0,
    baseDurationMax: 0,
    slowCommitCount: 0,
    lastPhase: '',
    lastStartTime: 0,
    lastCommitTime: 0,
    timer: null,
  }
}

function addPhaseCount(stats: ProfilerStats, phase: string): void {
  if (phase === 'mount') {
    stats.mountCount++
    return
  }

  if (phase === 'nested-update') {
    stats.nestedUpdateCount++
    return
  }

  stats.updateCount++
}

function clearStatsTimer(stats: ProfilerStats): void {
  if (stats.timer !== null) {
    clearTimeout(stats.timer)
    stats.timer = null
  }
}

function buildProfilerMetric(
  ctx: MonitorContext,
  id: string,
  stats: ProfilerStats,
): PerformanceEvent {
  const windowEnd = performance.now()

  const duration = Math.max(windowEnd - stats.windowStart, 1)

  return {
    ...createEventBase(ctx),

    category: 'performance',
    eventType: 'react_render',

    payload: {
      name: 'react-render',
      value: stats.actualDurationTotal,
      unit: 'ms',

      attributes: {
        id,
        windowStart: stats.windowStart,
        windowEnd,
        commitCount: stats.commitCount,
        mountCount: stats.mountCount,
        updateCount: stats.updateCount,
        nestedUpdateCount: stats.nestedUpdateCount,
        actualDurationMax: stats.actualDurationMax,
        baseDurationMax: stats.baseDurationMax,
        slowCommitCount: stats.slowCommitCount,

        commitPerSecond: (stats.commitCount * 1000) / duration,

        lastPhase: stats.lastPhase,
        lastStartTime: stats.lastStartTime,
        lastCommitTime: stats.lastCommitTime,
      },
    },
  }
}

export function createMonitorProfiler(ctx: MonitorContext, options: ReactProfilerOptions = {}) {
  const reportInterval = options.reportInterval || DEFAULT_REPORT_INTERVAL
  const maxCommitCount = options.maxCommitCount || DEFAULT_MAX_COMMIT_COUNT
  const slowCommitThreshold = options.slowCommitThreshold || DEFAULT_SLOW_COMMIT_THRESHOLD
  const statsById = new Map<string, ProfilerStats>()

  const flush = (id: string): void => {
    const stats = statsById.get(id)

    if (!stats || !stats.commitCount) {
      return
    }

    clearStatsTimer(stats)
    ctx.report(buildProfilerMetric(ctx, id, stats))
    statsById.set(id, createEmptyStats())
  }

  const scheduleFlush = (id: string, stats: ProfilerStats): void => {
    if (stats.timer !== null) {
      return
    }

    stats.timer = window.setTimeout(() => {
      flush(id)
    }, reportInterval)
  }

  const onRender: ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    const stats = statsById.get(id) || createEmptyStats()

    stats.commitCount++
    stats.actualDurationTotal += actualDuration
    stats.actualDurationMax = Math.max(stats.actualDurationMax, actualDuration)
    stats.baseDurationMax = Math.max(stats.baseDurationMax, baseDuration)
    stats.lastPhase = phase
    stats.lastStartTime = startTime
    stats.lastCommitTime = commitTime

    if (actualDuration >= slowCommitThreshold) {
      stats.slowCommitCount++
    }

    addPhaseCount(stats, phase)
    statsById.set(id, stats)

    if (stats.commitCount >= maxCommitCount) {
      flush(id)
      return
    }

    scheduleFlush(id, stats)
  }

  ctx.addDispose(() => {
    statsById.forEach((stats, id) => {
      clearStatsTimer(stats)
      flush(id)
    })
    statsById.clear()
  })

  return function MonitorProfiler({ id, children, disabled }: MonitorProfilerProps) {
    if (disabled) {
      return <>{children}</>
    }

    return (
      <Profiler id={id} onRender={onRender}>
        {children}
      </Profiler>
    )
  }
}

export function reactProfilerPlugin(options: ReactProfilerOptions = {}): MonitorPlugin {
  return {
    name: 'ai-performance:react-profiler',
    setup: (ctx) => {
      ctx.provide(REACT_PROFILER_CAPABILITY, createMonitorProfiler(ctx, options))
    },
  }
}
