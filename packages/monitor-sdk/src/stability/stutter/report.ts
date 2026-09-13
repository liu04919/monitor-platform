import { createEventBase, type EventBaseFields } from '../../common/event'
import { safely } from '../../common/safe'
import { sanitizeUrl } from '../../common/sanitize'
import type { MonitorContext, StabilityEvent } from '../../types'
import type { LoafEntry, SlowFrame, TimingSample } from './types'

export function readSlowFrame(entry: LoafEntry): SlowFrame {
  return {
    startTime: entry.startTime,
    duration: entry.duration,
    blockingDuration: entry.blockingDuration,
    renderStart: entry.renderStart,
    styleAndLayoutStart: entry.styleAndLayoutStart,
    // 最多保留最耗时的 5 个脚本入口；不复制原生条目里的 window 等对象。
    scripts: [...entry.scripts]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)
      .map((script) => ({
        startTime: script.startTime,
        duration: script.duration,
        sourceURL: script.sourceURL ? sanitizeUrl(script.sourceURL) : '',
        sourceFunctionName: script.sourceFunctionName.slice(0, 120),
        sourceCharPosition: script.sourceCharPosition,
        invokerType: script.invokerType.slice(0, 80),
        forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
      })),
  }
}

export function frameEventBase(ctx: MonitorContext, frame: SlowFrame): EventBaseFields {
  return {
    ...createEventBase(ctx),
    // 等待旁证不会改变事件时间。内部关联使用 performance 时间轴，协议使用 Unix 毫秒。
    timestamp: Math.round(performance.timeOrigin + frame.startTime),
  }
}

export function reportSlowFrame(
  ctx: MonitorContext,
  base: EventBaseFields,
  frame: SlowFrame,
  threshold: number,
  longTasks: TimingSample[],
  rafGaps: TimingSample[],
): void {
  const diagnostics: Record<string, unknown> = {
    source: 'long-animation-frame',
    scripts: frame.scripts,
  }
  if (longTasks.length > 0) {
    diagnostics.longTasks = {
      count: longTasks.length,
      maxDuration: Math.max(...longTasks.map((task) => task.duration)),
    }
  }
  if (rafGaps.length > 0) {
    diagnostics.rafGap = rafGaps.reduce((largest, gap) =>
      gap.duration > largest.duration ? gap : largest,
    )
  }

  const event: StabilityEvent = {
    ...base,
    category: 'stability',
    eventType: 'stutter',
    level: 'warning',
    breadcrumbs: [],
    payload: {
      message: `页面慢帧持续 ${Math.round(frame.duration)}ms`,
      metrics: {
        startTime: frame.startTime,
        duration: frame.duration,
        threshold,
        blockingDuration: frame.blockingDuration,
        renderStart: frame.renderStart,
        styleAndLayoutStart: frame.styleAndLayoutStart,
      },
      diagnostics,
    },
  }
  // 附件提供方出错不能让慢帧事件消失；每条最终事件只读取一次附件。
  safely(() => {
    event.breadcrumbs = ctx.getBreadcrumbs()
  })
  safely(() => {
    event.replayData = ctx.getReplayData() || undefined
  })
  safely(() => ctx.report(event))
}
