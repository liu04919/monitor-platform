export interface StutterOptions {
  /** LoAF duration 的上报门槛，默认 120ms，不能小于 API 的 50ms 采集门槛。 */
  durationThresholdMs?: number
  /** 两次上报的最小间隔，默认 3000ms；0 表示不限频。 */
  reportIntervalMs?: number
  /** 是否提前观察 rAF 间隔作为旁证，默认开启，不计算平均 FPS。 */
  includeRafGap?: boolean
}

export function stutterOptions(input: StutterOptions): Required<StutterOptions> {
  const options = {
    durationThresholdMs: input.durationThresholdMs ?? 120,
    reportIntervalMs: input.reportIntervalMs ?? 3000,
    includeRafGap: input.includeRafGap ?? true,
  }
  if (!Number.isFinite(options.durationThresholdMs) || options.durationThresholdMs < 50) {
    throw new Error('[monitor-sdk] durationThresholdMs 必须是至少 50 的有限数字')
  }
  if (!Number.isFinite(options.reportIntervalMs) || options.reportIntervalMs < 0) {
    throw new Error('[monitor-sdk] reportIntervalMs 必须是非负有限数字')
  }
  if (typeof options.includeRafGap !== 'boolean') {
    throw new Error('[monitor-sdk] includeRafGap 必须是布尔值')
  }
  return options
}

export interface TimingSample {
  startTime: number
  duration: number
}

export interface FrameScript extends TimingSample {
  sourceURL: string
  sourceFunctionName: string
  sourceCharPosition: number
  invokerType: string
  forcedStyleAndLayoutDuration: number
}

export interface SlowFrame extends TimingSample {
  blockingDuration: number
  renderStart: number
  styleAndLayoutStart: number
  scripts: FrameScript[]
}

// 当前 TypeScript DOM 类型尚未声明 LoAF；只描述用到的原生字段，不维护旧版 API 分支。
export interface LoafEntry extends PerformanceEntry {
  blockingDuration: number
  renderStart: number
  styleAndLayoutStart: number
  scripts: readonly FrameScript[]
}
