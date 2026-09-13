import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMonitor, type Monitor } from '../src/core'
import { stabilityPlugins, stutterPlugin, type StutterOptions } from '../src/stability'
import { aiPerformancePlugins } from '../src/aiPerformance'
import { matchingSamples, rememberSample } from '../src/stability/stutter/evidence'
import type { FrameScript, LoafEntry, TimingSample } from '../src/stability/stutter/types'
import type { MonitorContext, MonitorEvent, MonitorPlugin, StabilityEvent } from '../src/types'
import { visible } from './helpers'

const events: MonitorEvent[] = []
vi.mock('../src/transport', () => ({
  ReportTransport: class {
    report(event: MonitorEvent) {
      events.push(structuredClone(event))
    }
    destroy() {}
    async flush() {}
  },
}))

class FakeObserver {
  static supportedEntryTypes = ['long-animation-frame', 'longtask']
  static instances: FakeObserver[] = []
  static failedType = ''
  type = ''
  active = false
  observe = vi.fn((options: PerformanceObserverInit) => {
    this.type = options.type!
    if (this.type === FakeObserver.failedType) throw new Error('observe failed')
    this.active = true
  })
  disconnect = vi.fn(() => {
    this.active = false
  })
  constructor(private callback: PerformanceObserverCallback) {
    FakeObserver.instances.push(this)
  }
  emit(entries: TimingSample[], evenIfDisconnected = false) {
    if (!this.active && !evenIfDisconnected) return
    this.callback(
      { getEntries: () => entries } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    )
  }
}

let now = 1000
let nextFrameId = 0
let frames: Map<number, FrameRequestCallback>
let monitors: Monitor[] = []

beforeEach(() => {
  vi.useFakeTimers()
  now = 1000
  events.length = 0
  frames = new Map()
  FakeObserver.instances = []
  FakeObserver.failedType = ''
  FakeObserver.supportedEntryTypes = ['long-animation-frame', 'longtask']
  vi.stubGlobal('PerformanceObserver', FakeObserver)
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrameId, callback)
      return nextFrameId
    }),
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  )
  visible(true)
})

afterEach(() => {
  monitors.reverse().forEach((monitor) => monitor.destroy())
  monitors = []
  vi.useRealTimers()
})

function start(options: StutterOptions = {}, plugin?: MonitorPlugin) {
  const target = plugin ?? stutterPlugin(options)
  let ctx!: MonitorContext
  const monitor = createMonitor({
    url: '/collect',
    plugins: [
      {
        ...target,
        setup(context) {
          ctx = context
          return target.setup(context)
        },
      },
    ],
  })
  monitors.push(monitor)
  return { monitor, ctx }
}

function observer(type = 'long-animation-frame'): FakeObserver {
  return FakeObserver.instances.filter((item) => item.type === type && item.active).at(-1)!
}

function loaf(startTime = 1100, duration = 200, scripts: FrameScript[] = []): LoafEntry {
  return {
    name: 'long-animation-frame',
    entryType: 'long-animation-frame',
    startTime,
    duration,
    blockingDuration: Math.max(0, duration - 50),
    renderStart: startTime + duration - 10,
    styleAndLayoutStart: startTime + duration - 5,
    scripts,
    toJSON: () => ({}),
  }
}

function frame(timestamp: number): void {
  now = timestamp
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((callback) => callback(timestamp))
}

function wait(ms = 200): void {
  now += ms
  vi.advanceTimersByTime(ms)
}

function event(index = 0): StabilityEvent {
  return events[index] as StabilityEvent
}

describe('LoAF 触发，另外两路只提供旁证', () => {
  it('Long Task 和 rAF gap 无论多长都不能独立上报', () => {
    start()
    frame(1100)
    frame(2300)
    observer('longtask').emit([{ startTime: 1100, duration: 1200 }])
    wait(5000)
    expect(events).toEqual([])
  })

  it('LoAF 门槛以下不报，恰好达到门槛就报；不等待三路都命中', () => {
    start()
    observer().emit([loaf(1100, 119)])
    wait()
    expect(events).toEqual([])
    observer().emit([loaf(1300, 120)])
    wait(199)
    expect(events).toEqual([])
    wait(1)
    expect(events).toHaveLength(1)
    expect(event().payload.metrics?.duration).toBe(120)
    expect(event().payload.diagnostics).toEqual({ source: 'long-animation-frame', scripts: [] })
  })

  it.each(['before', 'after'])('旁证 %s LoAF 回调到达，都按发生时间合并为一条', (order) => {
    const { monitor, ctx } = start()
    monitor.addBreadcrumb({ category: 'custom', message: 'before-stutter' })
    const getReplay = vi.fn(() => 'recording')
    ctx.provide('replay:data', getReplay)
    const getBreadcrumbs = vi.spyOn(ctx, 'getBreadcrumbs')
    frame(1100)
    const addEvidence = () => {
      observer('longtask').emit([
        { startTime: 1105, duration: 160 },
        { startTime: 2000, duration: 900 },
      ])
      frame(1320)
    }
    if (order === 'before') addEvidence()
    observer().emit([loaf(1100, 200)])
    if (order === 'after') {
      wait(100)
      addEvidence()
    }
    wait()
    expect(events).toHaveLength(1)
    expect(event()).toMatchObject({
      category: 'stability',
      eventType: 'stutter',
      level: 'warning',
      schemaVersion: 2,
      timestamp: Math.round(performance.timeOrigin + 1100),
      breadcrumbs: [{ message: 'before-stutter' }],
      replayData: 'recording',
      payload: {
        metrics: { duration: 200, blockingDuration: 150 },
        diagnostics: {
          longTasks: { count: 1, maxDuration: 160 },
          rafGap: { startTime: 1100, duration: 220 },
        },
      },
    })
    expect(getReplay).toHaveBeenCalledTimes(1)
    expect(getBreadcrumbs).toHaveBeenCalledTimes(1)
  })

  it('不把最新但不相交的任务和 gap 硬塞进来，也不把缺失旁证填 0', () => {
    start()
    frame(1300)
    frame(1700)
    observer('longtask').emit([
      { startTime: 1000, duration: 100 },
      { startTime: 1300, duration: 500 },
    ])
    observer().emit([loaf(1100, 200)])
    wait()
    expect(event().payload.diagnostics).not.toHaveProperty('longTasks')
    expect(event().payload.diagnostics).not.toHaveProperty('rafGap')
  })

  it('同一批条目、随后回调共用一个等待窗口，只保留最慢帧', () => {
    const { ctx } = start({ reportIntervalMs: 0 })
    const replay = vi.fn(() => '')
    ctx.provide('replay:data', replay)
    observer().emit([loaf(1100, 150), loaf(1300, 250), loaf(1600, 120)])
    wait(100)
    observer().emit([loaf(1800, 300)])
    expect(replay).not.toHaveBeenCalled()
    wait(100)
    expect(events).toHaveLength(1)
    expect(event().payload.metrics?.duration).toBe(300)
    expect(replay).toHaveBeenCalledTimes(1)
  })

  it('限频依据 LoAF 发生时间，不让晚抵达的旧条目绕过间隔', () => {
    start()
    observer().emit([loaf(1100)])
    wait()
    now = 10_000
    observer().emit([loaf(1200, 500)])
    wait()
    expect(events).toHaveLength(1)
    observer().emit([loaf(4100)])
    wait()
    expect(events).toHaveLength(2)
  })

  it('等待窗口已经结束后到达的旁证不会再补报一条事件', () => {
    start()
    observer().emit([loaf()])
    wait()
    observer('longtask').emit([{ startTime: 1100, duration: 190 }])
    wait()
    expect(events).toHaveLength(1)
    expect(event().payload.diagnostics).not.toHaveProperty('longTasks')
  })
})

describe('能力检测和实例配置', () => {
  it('没有 LoAF 时连辅助监听都不启动，不降级成旧告警', () => {
    FakeObserver.supportedEntryTypes = ['longtask']
    start()
    expect(FakeObserver.instances).toEqual([])
    expect(frames.size).toBe(0)
  })
  it('没有 PerformanceObserver 的环境正常退出', () => {
    vi.stubGlobal('PerformanceObserver', undefined)
    expect(() => start()).not.toThrow()
    expect(frames.size).toBe(0)
  })
  it('LoAF observe 抛错时断开，不启动辅助监听', () => {
    FakeObserver.failedType = 'long-animation-frame'
    expect(() => start()).not.toThrow()
    expect(FakeObserver.instances).toHaveLength(1)
    expect(FakeObserver.instances[0].disconnect).toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })
  it.each(['unsupported', 'throws'])('Long Tasks %s 时 LoAF 仍可上报', (mode) => {
    if (mode === 'unsupported') FakeObserver.supportedEntryTypes = ['long-animation-frame']
    else FakeObserver.failedType = 'longtask'
    start()
    observer().emit([loaf()])
    wait()
    expect(events).toHaveLength(1)
    expect(event().payload.diagnostics).not.toHaveProperty('longTasks')
  })
  it('可关闭 rAF 辅助采集，同时继续 LoAF 和 Long Tasks', () => {
    start({ includeRafGap: false })
    expect(frames.size).toBe(0)
    expect(observer('longtask')).toBeDefined()
    observer().emit([loaf()])
    wait()
    expect(events).toHaveLength(1)
  })
  it('创建插件时复制参数，组合入口透传，AI 组合不再安装卡顿插件', () => {
    const options = { durationThresholdMs: 300, includeRafGap: false }
    const plugin = stabilityPlugins({ stutter: options }).find(
      (item) => item.name === 'stability:stutter',
    )!
    options.durationThresholdMs = 50
    options.includeRafGap = true
    start({}, plugin)
    observer().emit([loaf(1100, 200)])
    wait()
    expect(events).toEqual([])
    expect(frames.size).toBe(0)
    expect(
      aiPerformancePlugins().some(
        (item) => item.name.includes('stall') || item.name.includes('stutter'),
      ),
    ).toBe(false)
  })
  it.each([NaN, Infinity, -1, 0, 49])('拒绝非法 durationThresholdMs：%s', (durationThresholdMs) => {
    expect(() => stutterPlugin({ durationThresholdMs })).toThrow('durationThresholdMs')
  })
  it.each([NaN, Infinity, -1])('拒绝非法 reportIntervalMs：%s', (reportIntervalMs) => {
    expect(() => stutterPlugin({ reportIntervalMs })).toThrow('reportIntervalMs')
  })
  it('拒绝非布尔 includeRafGap', () => {
    expect(() => stutterPlugin({ includeRafGap: 'yes' as unknown as boolean })).toThrow(
      'includeRafGap',
    )
  })
  it('多个实例互不干扰，销毁一个不影响另一个', () => {
    const first = start()
    const firstObserver = observer()
    start()
    const secondObserver = observer()
    expect(frames.size).toBe(2)
    first.monitor.destroy()
    firstObserver.emit([loaf()], true)
    secondObserver.emit([loaf()])
    wait()
    expect(events).toHaveLength(1)
    expect(frames.size).toBe(1)
  })
})

describe('页面生命周期和错误隔离', () => {
  it('初始隐藏不启动，恢复后只观察新的条目且不 buffered', () => {
    visible(false)
    start()
    expect(FakeObserver.instances).toEqual([])
    now = 5000
    visible(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(observer().observe).toHaveBeenCalledWith({
      type: 'long-animation-frame',
      buffered: false,
    })
    observer().emit([loaf(1100)])
    wait()
    expect(events).toEqual([])
    observer().emit([loaf(5300)])
    wait()
    expect(events).toHaveLength(1)
  })
  it('后台一分钟无 rAF 回调，恢复第一帧不产生假 gap；待报事件和旧旁证一并清空', () => {
    start()
    frame(1100)
    observer('longtask').emit([{ startTime: 1100, duration: 200 }])
    observer().emit([loaf()])
    const oldObserver = observer()
    visible(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(0)
    wait(60_000)
    expect(events).toEqual([])
    visible(true)
    document.dispatchEvent(new Event('visibilitychange'))
    oldObserver.emit([loaf()], true)
    frame(62_000)
    observer().emit([loaf(62_000)])
    wait()
    expect(events).toHaveLength(1)
    expect(event().payload.diagnostics).not.toHaveProperty('rafGap')
    expect(event().payload.diagnostics).not.toHaveProperty('longTasks')
  })
  it.each([
    ['pagehide', 'pageshow'],
    ['freeze', 'resume'],
  ])('%s 暂停，%s 恢复，重复恢复不重复安装', (hide, show) => {
    start()
    const target = hide === 'pagehide' ? window : document
    target.dispatchEvent(new Event(hide))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(0)
    target.dispatchEvent(new Event(show))
    target.dispatchEvent(new Event(show))
    expect(frames.size).toBe(1)
    expect(FakeObserver.instances.filter((item) => item.active)).toHaveLength(2)
  })
  it('destroy 取消计时器、rAF、Observer 和所有恢复入口', () => {
    const { monitor } = start()
    observer().emit([loaf()])
    const oldObserver = observer()
    monitor.destroy()
    oldObserver.emit([loaf()], true)
    window.dispatchEvent(new Event('pageshow'))
    document.dispatchEvent(new Event('resume'))
    wait()
    expect(events).toEqual([])
    expect(frames.size).toBe(0)
    expect(FakeObserver.instances.every((item) => !item.active)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('首个 rAF 时间戳早于安装时刻时，不把跨安装边界的 gap 当旁证', () => {
    start()
    frame(990)
    frame(1250)
    observer().emit([loaf(1100, 150)])
    wait()
    expect(events).toHaveLength(1)
    expect(event().payload.diagnostics).not.toHaveProperty('rafGap')
  })
  it('附件提供方抛错不丢掉慢帧事件', () => {
    const { ctx } = start()
    ctx.provide('replay:data', () => {
      throw new Error('replay')
    })
    vi.spyOn(ctx, 'getBreadcrumbs').mockImplementation(() => {
      throw new Error('breadcrumbs')
    })
    observer().emit([loaf()])
    expect(() => wait()).not.toThrow()
    expect(events).toHaveLength(1)
    expect(event().breadcrumbs).toEqual([])
    expect(event().replayData).toBeUndefined()
  })
  it('上报抛错不停止之后的采集', () => {
    const { ctx } = start({ reportIntervalMs: 0 })
    vi.spyOn(ctx, 'report').mockImplementationOnce(() => {
      throw new Error('report')
    })
    observer().emit([loaf()])
    expect(() => wait()).not.toThrow()
    observer().emit([loaf(1500)])
    wait()
    expect(events).toHaveLength(1)
    expect(frames.size).toBe(1)
  })
})

describe('诊断数据有界且可序列化', () => {
  it('两个缓冲分别限制 100 条、10 秒，乱序样本也能正确过期', () => {
    const samples: TimingSample[] = []
    for (let i = 0; i < 120; i++) rememberSample(samples, { startTime: i * 10, duration: 60 }, 2000)
    expect(samples).toHaveLength(100)
    rememberSample(samples, { startTime: 0, duration: 60 }, 20_000)
    expect(samples).toEqual([])
    rememberSample(samples, { startTime: 20_000, duration: 60 }, 20_100)
    expect(matchingSamples(samples, { startTime: 20_000, duration: 100 }, 31_000)).toEqual([])
    expect(samples).toEqual([])
  })
  it('相交才关联，只碰到时间边界不算；匹配不消耗样本', () => {
    const samples = [
      { startTime: 1000, duration: 100 },
      { startTime: 1050, duration: 100 },
      { startTime: 1200, duration: 100 },
    ]
    expect(matchingSamples(samples, { startTime: 1100, duration: 100 }, 1400)).toEqual([samples[1]])
    expect(samples).toHaveLength(3)
  })
  it('脚本只保留耗时最高的 5 个，脱敏 URL，不携带 window 或原生对象', () => {
    start()
    const scripts = Array.from({ length: 12 }, (_, index) => ({
      startTime: 1100 + index,
      duration: index + 5,
      sourceURL: 'https://user:password@example.com/app.js?token=secret#token=secret',
      sourceFunctionName: 'f'.repeat(200),
      sourceCharPosition: index,
      invokerType: 'event-listener',
      forcedStyleAndLayoutDuration: 0,
      window,
    }))
    observer().emit([loaf(1100, 200, scripts)])
    scripts[11].sourceURL = 'https://changed.example/'
    wait()
    const result = event().payload.diagnostics?.scripts as FrameScript[]
    expect(result).toHaveLength(5)
    expect(result.map((script) => script.duration)).toEqual([16, 15, 14, 13, 12])
    expect(result[0].sourceURL).toBe('https://example.com/app.js')
    expect(result[0].sourceFunctionName).toHaveLength(120)
    expect(result[0]).not.toHaveProperty('window')
    expect(JSON.stringify(event())).not.toMatch(/secret|password|changed/)
  })
})
