import { Profiler } from 'react'
import type { ProfilerOnRenderCallback } from 'react'
import { createEventBase } from '../common/event'
import { safely } from '../common/safe'
import type { MonitorContext, MonitorPlugin, PerformanceEvent } from '../types'
import type { MonitorProfilerProps, ReactProfilerOptions } from './types'

export const REACT_PROFILER_CAPABILITY = 'ai-performance:react-profiler'

function profilerOptions(input: ReactProfilerOptions): Required<ReactProfilerOptions> {
  const options = {
    reportIntervalMs: input.reportIntervalMs ?? 1000,
    maxCommitCount: input.maxCommitCount ?? 20,
    slowRenderThresholdMs: input.slowRenderThresholdMs ?? 16,
  }
  if (
    !Number.isFinite(options.reportIntervalMs) ||
    options.reportIntervalMs <= 0 ||
    options.reportIntervalMs > 2_147_483_647
  ) {
    throw new Error('[monitor-sdk] reportIntervalMs 必须是大于 0 且不超过 2147483647 的有限数字')
  }
  if (!Number.isSafeInteger(options.maxCommitCount) || options.maxCommitCount < 1) {
    throw new Error('[monitor-sdk] maxCommitCount 必须是正安全整数')
  }
  if (!Number.isFinite(options.slowRenderThresholdMs) || options.slowRenderThresholdMs < 0) {
    throw new Error('[monitor-sdk] slowRenderThresholdMs 必须是非负有限数字')
  }
  return options
}

type ProfilerStats = {
  windowStart: number
  commitCount: number
  mountCount: number
  updateCount: number
  nestedUpdateCount: number
  actualDurationTotal: number
  actualDurationMax: number
  baseDurationMax: number
  slowRenderCount: number
  timer: number | null
}

function createStats(startTime: number): ProfilerStats {
  return {
    windowStart: startTime,
    commitCount: 0,
    mountCount: 0,
    updateCount: 0,
    nestedUpdateCount: 0,
    actualDurationTotal: 0,
    actualDurationMax: 0,
    baseDurationMax: 0,
    slowRenderCount: 0,
    timer: null,
  }
}

function addRender(
  stats: ProfilerStats,
  phase: Parameters<ProfilerOnRenderCallback>[1],
  actualDuration: number,
  baseDuration: number,
  slowRenderThresholdMs: number,
): void {
  stats.commitCount++
  stats.actualDurationTotal += actualDuration
  stats.actualDurationMax = Math.max(stats.actualDurationMax, actualDuration)
  stats.baseDurationMax = Math.max(stats.baseDurationMax, baseDuration)
  if (actualDuration >= slowRenderThresholdMs) stats.slowRenderCount++

  switch (phase) {
    case 'mount':
      stats.mountCount++
      break
    case 'update':
      stats.updateCount++
      break
    case 'nested-update':
      stats.nestedUpdateCount++
      break
  }
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
        windowEnd: performance.now(),
        commitCount: stats.commitCount,
        mountCount: stats.mountCount,
        updateCount: stats.updateCount,
        nestedUpdateCount: stats.nestedUpdateCount,
        actualDurationMax: stats.actualDurationMax,
        baseDurationMax: stats.baseDurationMax,
        slowRenderCount: stats.slowRenderCount,
      },
    },
  }
}

export function createMonitorProfiler(ctx: MonitorContext, input: ReactProfilerOptions = {}) {
  const options = profilerOptions(input)
  const statsById = new Map<string, ProfilerStats>()
  let stopped = false

  const flush = (id: string): void => {
    const stats = statsById.get(id)

    if (stopped || !stats) return

    clearStatsTimer(stats)
    // 先移除本轮统计；下一次真正渲染时再开新窗口，不保留空桶和闲置 ID。
    statsById.delete(id)
    safely(() => ctx.report(buildProfilerMetric(ctx, id, stats)))
  }

  const onRender: ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
  ) => {
    if (stopped) return
    let stats = statsById.get(id)
    if (!stats) {
      stats = createStats(startTime)
      statsById.set(id, stats)
    }
    addRender(stats, phase, actualDuration, baseDuration, options.slowRenderThresholdMs)

    if (stats.commitCount >= options.maxCommitCount) {
      flush(id)
      return
    }

    // 从本轮第一次回调起计时，后续更新不推迟上报。
    if (stats.timer === null) {
      stats.timer = window.setTimeout(() => flush(id), options.reportIntervalMs)
    }
  }

  ctx.addDispose(() => {
    // 核心层进入销毁后已禁止上报；这里仅停止采集并丢弃尚未上报的统计。
    stopped = true
    statsById.forEach(clearStatsTimer)
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

export function reactProfilerPlugin(input: ReactProfilerOptions = {}): MonitorPlugin {
  const options = profilerOptions(input)
  return {
    name: 'ai-performance:react-profiler',
    setup: (ctx) => {
      ctx.provide(REACT_PROFILER_CAPABILITY, createMonitorProfiler(ctx, options))
    },
  }
}
