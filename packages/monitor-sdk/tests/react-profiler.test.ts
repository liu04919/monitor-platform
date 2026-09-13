import { act, createElement, useEffect, useState } from 'react'
import type { ProfilerOnRenderCallback, ProfilerProps, ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMonitor, type Monitor } from '../src/core'
import {
  createMonitorProfiler,
  reactProfilerPlugin,
  REACT_PROFILER_CAPABILITY,
} from '../src/aiPerformance/reactProfiler'
import type { ReactProfilerOptions } from '../src/aiPerformance/types'
import type { MonitorContext, MonitorEvent, MonitorPlugin, PerformanceEvent } from '../src/types'

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

let now = 1000
let monitors: Monitor[] = []
let roots: Root[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  now = 1000
  events.length = 0
})

afterEach(() => {
  monitors.forEach((monitor) => monitor.destroy())
  roots.forEach((root) => act(() => root.unmount()))
  monitors = []
  roots = []
  document.body.replaceChildren()
  vi.useRealTimers()
})

function start(options: ReactProfilerOptions = {}, plugin?: MonitorPlugin) {
  const target = plugin ?? reactProfilerPlugin(options)
  let ctx!: MonitorContext
  const monitor = createMonitor({
    url: '/collect',
    userId: 'profiler-test',
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
  const Component =
    monitor.getCapability<ReturnType<typeof createMonitorProfiler>>(REACT_PROFILER_CAPABILITY)!
  // 受控回调用于验证聚合算法；真实 React 回调在下方及浏览器测试中另行覆盖。
  const element = Component({ id: 'panel', children: null }) as ReactElement<ProfilerProps>
  const onRender = element.props.onRender
  return { monitor, ctx, Component, onRender }
}

function render(
  callback: ProfilerOnRenderCallback,
  id = 'panel',
  phase: Parameters<ProfilerOnRenderCallback>[1] = 'update',
  actualDuration = 10,
  baseDuration = 20,
) {
  callback(id, phase, actualDuration, baseDuration, now - actualDuration, now)
}

function wait(ms: number) {
  now += ms
  vi.advanceTimersByTime(ms)
}

function metric(index = 0) {
  return events[index] as PerformanceEvent
}

describe('React Profiler 汇总', () => {
  it('未渲染不创建计时器或空报表', () => {
    start()
    wait(5000)
    expect(events).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('默认等待 1 秒，汇总三种阶段、总耗时、最大值及慢渲染次数', () => {
    const { onRender } = start()
    render(onRender, 'panel', 'mount', 10, 40)
    wait(200)
    render(onRender, 'panel', 'update', 16, 25)
    wait(200)
    render(onRender, 'panel', 'nested-update', 20, 30)
    wait(599)
    expect(events).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(1)
    wait(1)
    expect(events).toHaveLength(1)
    expect(metric()).toMatchObject({
      schemaVersion: 2,
      category: 'performance',
      eventType: 'react_render',
      userId: 'profiler-test',
      payload: {
        name: 'react-render',
        value: 46,
        unit: 'ms',
        attributes: {
          id: 'panel',
          windowStart: 990,
          windowEnd: 2000,
          commitCount: 3,
          mountCount: 1,
          updateCount: 1,
          nestedUpdateCount: 1,
          actualDurationMax: 20,
          baseDurationMax: 40,
          slowRenderCount: 2,
        },
      },
    })
    expect(Object.keys(metric().payload.attributes!).sort()).toEqual(
      [
        'id',
        'windowStart',
        'windowEnd',
        'commitCount',
        'mountCount',
        'updateCount',
        'nestedUpdateCount',
        'actualDurationMax',
        'baseDurationMax',
        'slowRenderCount',
      ].sort(),
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('默认累计 20 次提交提前上报，并取消原计时器', () => {
    const { onRender } = start()
    for (let i = 0; i < 19; i++) render(onRender)
    expect(events).toHaveLength(0)
    render(onRender)
    expect(events).toHaveLength(1)
    expect(metric().payload.attributes?.commitCount).toBe(20)
    expect(vi.getTimerCount()).toBe(0)
    wait(1000)
    expect(events).toHaveLength(1)
  })

  it('长时间闲置后，以新一轮首个渲染的 startTime 开窗', () => {
    const { onRender } = start()
    render(onRender)
    wait(1000)
    wait(60_000)
    render(onRender)
    wait(1000)
    expect(metric(1).payload.attributes).toMatchObject({
      windowStart: 61_990,
      windowEnd: 63_000,
      commitCount: 1,
      mountCount: 0,
      updateCount: 1,
      nestedUpdateCount: 0,
    })
    expect(metric(1).payload.value).toBe(10)
  })

  it('次数触发后同一个 ID 从零累计，不重复发送旧统计', () => {
    const { onRender } = start({ maxCommitCount: 1 })
    render(onRender, 'panel', 'mount', 30)
    wait(50)
    render(onRender, 'panel', 'update', 5)
    expect(events).toHaveLength(2)
    expect(metric(1).payload).toMatchObject({
      value: 5,
      attributes: { windowStart: 1045, commitCount: 1, slowRenderCount: 0 },
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('不同 ID 有独立窗口，不相互推迟计时或累计次数', () => {
    const { onRender } = start()
    render(onRender, 'a')
    wait(500)
    render(onRender, 'b')
    expect(vi.getTimerCount()).toBe(2)
    wait(500)
    expect(events).toHaveLength(1)
    expect(metric().payload.attributes?.id).toBe('a')
    wait(500)
    expect(metric(1).payload.attributes?.id).toBe('b')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('同一 ID 汇总多个 Profiler 回调，不把 commitTime 当全局去重键', () => {
    const { onRender } = start({ maxCommitCount: 2 })
    render(onRender, 'shared', 'mount', 5)
    render(onRender, 'shared', 'mount', 10)
    expect(metric().payload).toMatchObject({ value: 15, attributes: { commitCount: 2 } })
  })

  it('多个实例复用同一插件对象时，统计与销毁仍相互隔离', () => {
    const plugin = reactProfilerPlugin({ maxCommitCount: 2 })
    const a = start({}, plugin)
    const b = start({}, plugin)
    render(a.onRender)
    render(b.onRender)
    a.monitor.destroy()
    render(b.onRender)
    expect(events).toHaveLength(1)
    expect(metric().payload.attributes?.commitCount).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('上报失败不传播到 React，且失败窗口不会留到下一次', () => {
    const { ctx, onRender } = start({ maxCommitCount: 1 })
    vi.spyOn(ctx, 'report').mockImplementationOnce(() => {
      throw new Error('report failed')
    })
    expect(() => render(onRender)).not.toThrow()
    render(onRender, 'panel', 'update', 5)
    expect(events).toHaveLength(1)
    expect(metric().payload.value).toBe(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('异步计时器内上报失败也不会泄漏异常或留下计时器', () => {
    const { ctx, onRender } = start()
    vi.spyOn(ctx, 'report').mockImplementationOnce(() => {
      throw new Error('report failed')
    })
    render(onRender)
    expect(() => wait(1000)).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
    render(onRender)
    wait(1000)
    expect(metric().payload.attributes?.commitCount).toBe(1)
  })
})

describe('销毁与配置', () => {
  it('销毁仅取消和丢弃待报统计，不调用已失效的 report', () => {
    const { ctx, monitor, onRender } = start()
    const report = vi.spyOn(ctx, 'report')
    render(onRender)
    render(onRender, 'other')
    monitor.destroy()
    monitor.destroy()
    expect(report).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    render(onRender)
    wait(5000)
    expect(events).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('monitor.flush 只刷新传输队列，不提前刷新采集统计', async () => {
    const { monitor, onRender } = start()
    render(onRender)
    await monitor.flush()
    expect(events).toHaveLength(0)
    wait(1000)
    expect(events).toHaveLength(1)
  })

  it('slowRenderThresholdMs 为 0 时不退回默认值', () => {
    const { onRender } = start({ slowRenderThresholdMs: 0, maxCommitCount: 1 })
    render(onRender, 'panel', 'mount', 0, 0)
    expect(metric().payload.attributes?.slowRenderCount).toBe(1)
  })

  it('插件创建时复制配置，随后修改输入不影响尚未安装的插件', () => {
    const input = { reportIntervalMs: 100, maxCommitCount: 2, slowRenderThresholdMs: 5 }
    const plugin = reactProfilerPlugin(input)
    Object.assign(input, { reportIntervalMs: 1, maxCommitCount: 1, slowRenderThresholdMs: 100 })
    const { onRender } = start({}, plugin)
    render(onRender)
    wait(99)
    expect(events).toHaveLength(0)
    wait(1)
    expect(metric().payload.attributes?.slowRenderCount).toBe(1)
  })

  it.each([
    ['reportIntervalMs', 0],
    ['reportIntervalMs', -1],
    ['reportIntervalMs', NaN],
    ['reportIntervalMs', Infinity],
    ['reportIntervalMs', 2_147_483_648],
    ['maxCommitCount', 0],
    ['maxCommitCount', -1],
    ['maxCommitCount', 1.5],
    ['maxCommitCount', NaN],
    ['maxCommitCount', Infinity],
    ['maxCommitCount', Number.MAX_SAFE_INTEGER + 1],
    ['slowRenderThresholdMs', -1],
    ['slowRenderThresholdMs', NaN],
    ['slowRenderThresholdMs', Infinity],
  ])('创建插件时拒绝非法配置 %s=%s', (key, value) => {
    expect(() => reactProfilerPlugin({ [key]: value })).toThrow(String(key))
  })

  it('直接调用工厂也复制并校验配置', () => {
    const { ctx } = start()
    expect(() => createMonitorProfiler(ctx, { maxCommitCount: 0 })).toThrow('maxCommitCount')
    const input = { maxCommitCount: 2 }
    const Component = createMonitorProfiler(ctx, input)
    input.maxCommitCount = 1
    const element = Component({ id: 'direct', children: null }) as ReactElement<ProfilerProps>
    render(element.props.onRender)
    expect(events).toHaveLength(0)
    render(element.props.onRender)
    expect(events).toHaveLength(1)
  })
})

describe('真实 React 渲染', () => {
  it('包装组件身份稳定，状态更新不重挂载；SDK 销毁后业务仍能渲染', () => {
    const { monitor, Component } = start({ maxCommitCount: 1 })
    const mount = vi.fn()
    function Counter() {
      const [count, setCount] = useState(0)
      useEffect(() => {
        mount()
      }, [])
      return createElement('button', { onClick: () => setCount((value) => value + 1) }, count)
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    act(() =>
      root.render(createElement(Component, { id: 'counter', children: createElement(Counter) })),
    )
    const button = container.querySelector('button')!
    expect(metric().payload.attributes).toMatchObject({ commitCount: 1, mountCount: 1 })
    act(() => button.click())
    expect(button.textContent).toBe('1')
    expect(metric(1).payload.attributes).toMatchObject({ commitCount: 1, updateCount: 1 })
    expect(monitor.getCapability(REACT_PROFILER_CAPABILITY)).toBe(Component)
    monitor.destroy()
    act(() => button.click())
    expect(button.textContent).toBe('2')
    expect(mount).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disabled 时仍然呈现 children，不产生统计', () => {
    const { Component } = start({ maxCommitCount: 1 })
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)
    act(() =>
      root.render(
        createElement(Component, { id: 'disabled', disabled: true, children: 'content' }),
      ),
    )
    expect(container.textContent).toBe('content')
    expect(events).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
