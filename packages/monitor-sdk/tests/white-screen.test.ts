import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMonitor, type Monitor } from '../src/core'
import { stabilityPlugins, whiteScreenPlugin, type WhiteScreenOptions } from '../src/stability'
import type { MonitorEvent, MonitorPlugin } from '../src/types'
import { capture, visible } from './helpers'

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

const hitTest = vi.fn<(x: number, y: number) => Element[]>()
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
let monitors: Monitor[] = []

beforeEach(() => {
  vi.useFakeTimers()
  events.length = 0
  visible(true)
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
  vi.stubGlobal('innerWidth', 1000)
  vi.stubGlobal('innerHeight', 800)
  // happy-dom 不做布局命中测试；这里控制命中栈，真实布局在浏览器用例验证。
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: hitTest })
  hitTest.mockReset().mockReturnValue([document.body, document.documentElement])
})

afterEach(() => {
  monitors.reverse().forEach((monitor) => monitor.destroy())
  monitors = []
  document.body.replaceChildren()
  if (originalHitTest) Object.defineProperty(document, 'elementsFromPoint', originalHitTest)
  else Reflect.deleteProperty(document, 'elementsFromPoint')
  vi.useRealTimers()
})

function start(plugin: MonitorPlugin = whiteScreenPlugin()) {
  const test = capture()
  const monitor = createMonitor({ url: '/collect', plugins: [test.plugin, plugin] })
  monitors.push(monitor)
  return { monitor, ctx: test.context() }
}

function content(): Element {
  const root = document.createElement('div')
  root.id = 'root'
  const main = document.createElement('main')
  root.append(main)
  document.body.append(root)
  return main
}

function sampleWithBlankCount(blankCount: number): void {
  const main = content()
  let point = 0
  hitTest.mockImplementation(() => {
    const blank = point % 33 < blankCount
    point++
    return [blank ? document.body : main]
  })
}

describe('白屏采样规则', () => {
  it('米字四条线各 9 点且中心只采一次，2 秒复检后上报并附带诊断快照', () => {
    const { monitor, ctx } = start()
    expect(hitTest).toHaveBeenCalledTimes(33)
    const points = hitTest.mock.calls.map(([x, y]) => `${x},${y}`)
    expect(new Set(points).size).toBe(33)
    expect(points.filter((point) => point === '500,400')).toHaveLength(1)
    expect(hitTest.mock.calls.filter(([, y]) => y === 400)).toHaveLength(9)
    expect(hitTest.mock.calls.filter(([x]) => x === 500)).toHaveLength(9)
    expect(hitTest.mock.calls.filter(([x, y]) => x / 1000 === y / 800)).toHaveLength(9)
    expect(hitTest.mock.calls.filter(([x, y]) => x / 1000 + y / 800 === 1)).toHaveLength(9)
    expect(hitTest.mock.calls.every(([x, y]) => x > 0 && x < 1000 && y > 0 && y < 800)).toBe(true)
    monitor.addBreadcrumb({ category: 'custom', message: 'before-white-screen' })
    ctx.provide('replay:data', () => 'recording')
    vi.advanceTimersByTime(1999)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      schemaVersion: 2,
      eventType: 'white_screen',
      category: 'stability',
      level: 'error',
      replayData: 'recording',
      breadcrumbs: [{ message: 'before-white-screen' }],
      payload: {
        message: '页面白屏，两次采样确认',
        metrics: { recheckDelayMs: 2000, blankPoints: 33, totalPoints: 33, blankRatio: 1 },
      },
    })
  })

  it('命中 #root 内的业务元素不算空白，不把根节点规则用于后代', () => {
    const main = content()
    hitTest.mockReturnValue([main, main.parentElement!, document.body, document.documentElement])
    start()
    vi.advanceTimersByTime(10000)
    expect(events).toEqual([])
  })

  it('骨架屏命中空白名单后停止，不穿透到下方业务内容', () => {
    const skeleton = document.createElement('div')
    skeleton.className = 'skeleton'
    hitTest.mockReturnValue([skeleton, content(), document.body])
    start(whiteScreenPlugin({ blankSelectors: ['.skeleton'] }))
    vi.advanceTimersByTime(6000)
    expect(events).toHaveLength(1)
  })

  it('骨架屏后代需要显式配置后代选择器', () => {
    const skeleton = document.createElement('div')
    skeleton.className = 'skeleton'
    const bar = document.createElement('span')
    skeleton.append(bar)
    hitTest.mockReturnValue([bar, skeleton, document.body])
    const first = start(whiteScreenPlugin({ blankSelectors: ['.skeleton'] }))
    vi.advanceTimersByTime(6000)
    expect(events).toEqual([])
    first.monitor.destroy()
    start(whiteScreenPlugin({ blankSelectors: ['.skeleton', '.skeleton *'] }))
    vi.advanceTimersByTime(6000)
    expect(events).toHaveLength(1)
  })

  it('忽略遮罩及其后代后，能找到下方的业务内容', () => {
    const mask = document.createElement('div')
    mask.className = 'mask'
    const spinner = document.createElement('span')
    mask.append(spinner)
    hitTest.mockReturnValue([spinner, mask, content(), document.body])
    start(whiteScreenPlugin({ ignoreSelectors: ['.mask'] }))
    vi.advanceTimersByTime(6000)
    expect(events).toEqual([])
  })

  it('忽略遮罩及其后代后只剩容器，判为空白', () => {
    const mask = document.createElement('div')
    mask.className = 'mask'
    const spinner = document.createElement('span')
    mask.append(spinner)
    hitTest.mockReturnValue([spinner, mask, document.body])
    start(whiteScreenPlugin({ ignoreSelectors: ['.mask'] }))
    vi.advanceTimersByTime(6000)
    expect(events).toHaveLength(1)
  })

  it('忽略规则优先于空白规则', () => {
    const mask = document.createElement('div')
    mask.className = 'mask'
    hitTest.mockReturnValue([mask, content()])
    start(whiteScreenPlugin({ blankSelectors: ['.mask'], ignoreSelectors: ['.mask'] }))
    vi.advanceTimersByTime(6000)
    expect(events).toEqual([])
  })

  it('没有命中元素或所有元素都被忽略，判为空白', () => {
    hitTest.mockImplementation((x) => (x < 500 ? [] : [document.body]))
    start(whiteScreenPlugin({ ignoreSelectors: ['body'] }))
    vi.advanceTimersByTime(6000)
    expect(events).toHaveLength(1)
  })

  it('只剩中心点有内容时，其余 32 个空白点仍能通过比例检测', () => {
    const main = content()
    hitTest.mockImplementation((x, y) => (x === 500 && y === 400 ? [main] : [document.body]))
    start()
    vi.advanceTimersByTime(10000)
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ metrics: { blankPoints: 32, totalPoints: 33 } })
  })

  it.each([23, 24])('默认 70%% 门槛的边界：%s 个空白点', (blankPoints) => {
    sampleWithBlankCount(blankPoints)
    start()
    vi.advanceTimersByTime(1999)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(blankPoints === 24 ? 1 : 0)
  })

  it('比例必须严格大于配置值，等于时不进入疑似状态', () => {
    sampleWithBlankCount(24)
    start(whiteScreenPlugin({ blankRatio: 24 / 33 }))
    vi.advanceTimersByTime(4000)
    expect(events).toEqual([])
    sampleWithBlankCount(25)
    vi.advanceTimersByTime(2000)
    expect(events).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(events).toHaveLength(1)
  })

  it('首检不超过比例、第二次才超过时，必须再等一次复检', () => {
    sampleWithBlankCount(23)
    start()
    sampleWithBlankCount(24)
    vi.advanceTimersByTime(2000)
    expect(events).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(events).toHaveLength(1)
  })

  it('自定义空白数组替换默认值，允许显式传入空数组', () => {
    const first = start(whiteScreenPlugin({ blankSelectors: ['.skeleton'] }))
    vi.advanceTimersByTime(6000)
    expect(events).toEqual([])
    first.monitor.destroy()
    start(whiteScreenPlugin({ blankSelectors: [] }))
    vi.advanceTimersByTime(6000)
    expect(events).toEqual([])
  })
})

describe('白屏计时与生命周期', () => {
  it('load 延迟 8 秒时不立即上报，也不会重复启动定时器', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    start()
    vi.advanceTimersByTime(8000)
    expect(hitTest).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    window.dispatchEvent(new Event('load'))
    window.dispatchEvent(new Event('pageshow'))
    expect(events).toEqual([])
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1999)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(1)
    vi.advanceTimersByTime(6000)
    expect(events).toHaveLength(1)
  })

  it('首次疑似采样在第 2 秒时，必须到第 4 秒复检才上报', () => {
    hitTest.mockReturnValue([content()])
    start()
    vi.advanceTimersByTime(1000)
    hitTest.mockReturnValue([document.body])
    vi.advanceTimersByTime(2999)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(1)
  })

  it('同一段白屏只报一次，检测到恢复后可再次上报', () => {
    start()
    vi.advanceTimersByTime(20000)
    expect(events).toHaveLength(1)
    hitTest.mockReturnValue([content()])
    vi.advanceTimersByTime(2000)
    hitTest.mockReturnValue([document.body])
    vi.advanceTimersByTime(3999)
    expect(events).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(2)
  })

  it('复检恢复正常时取消疑似状态，下一次白屏需要重新首检和复检', () => {
    start()
    vi.advanceTimersByTime(1000)
    hitTest.mockReturnValue([content()])
    vi.advanceTimersByTime(1000)
    expect(events).toEqual([])
    hitTest.mockReturnValue([document.body])
    vi.advanceTimersByTime(2000)
    expect(events).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(events).toHaveLength(1)
  })

  it('后台停止采样，不累计隐藏时间，回到前台重新计时', () => {
    start()
    vi.advanceTimersByTime(1000)
    visible(false)
    document.dispatchEvent(new Event('visibilitychange'))
    const samples = hitTest.mock.calls.length
    vi.advanceTimersByTime(60000)
    expect(hitTest).toHaveBeenCalledTimes(samples)
    expect(vi.getTimerCount()).toBe(0)
    expect(events).toEqual([])
    visible(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(1999)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(1)
  })

  it('安装时已经隐藏，则等可见后才开始采样', () => {
    visible(false)
    start()
    vi.advanceTimersByTime(60000)
    expect(hitTest).not.toHaveBeenCalled()
    visible(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(6000)
    expect(events).toHaveLength(1)
  })

  it('pagehide 暂停，pageshow 恢复时重新计时', () => {
    start()
    vi.advanceTimersByTime(1000)
    window.dispatchEvent(new Event('pagehide'))
    vi.advanceTimersByTime(60000)
    expect(events).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    window.dispatchEvent(new Event('pageshow'))
    vi.advanceTimersByTime(1999)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(1)
  })

  it('零尺寸视口不算白屏，恢复尺寸后重新计时', () => {
    start()
    vi.advanceTimersByTime(1000)
    vi.stubGlobal('innerWidth', 0)
    vi.advanceTimersByTime(20000)
    expect(events).toEqual([])
    vi.stubGlobal('innerWidth', 1000)
    vi.advanceTimersByTime(2999)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(1)
  })

  it('系统时间跳变不会提前触发复检或改变复检间隔指标', () => {
    start()
    vi.spyOn(Date, 'now').mockReturnValue(9999999999999)
    vi.advanceTimersByTime(1999)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ metrics: { recheckDelayMs: 2000 } })
  })

  it('销毁会停止定时器并移除监听，后续生命周期事件不会复活插件', () => {
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const { monitor } = start()
    monitor.use(whiteScreenPlugin())
    expect(vi.getTimerCount()).toBe(1)
    monitor.destroy()
    monitor.destroy()
    expect(vi.getTimerCount()).toBe(0)
    expect(removeDocument.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(
      1,
    )
    expect(removeWindow.mock.calls.map(([type]) => type)).toEqual(['pageshow', 'pagehide'])
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pageshow'))
    vi.advanceTimersByTime(10000)
    expect(events).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('等待 load 时销毁，不会在加载完成后启动', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const { monitor } = start()
    monitor.destroy()
    window.dispatchEvent(new Event('load'))
    window.dispatchEvent(new Event('pageshow'))
    vi.advanceTimersByTime(10000)
    expect(hitTest).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('白屏插件配置', () => {
  it('不同实例使用不同名单，销毁其中一个不影响另一个', () => {
    const a = start(whiteScreenPlugin({ blankSelectors: [], recheckIntervalMs: 1000 }))
    const b = start(whiteScreenPlugin({ recheckIntervalMs: 2000 }))
    b.monitor.addBreadcrumb({ category: 'custom', message: 'only-b' })
    vi.advanceTimersByTime(1000)
    a.monitor.destroy()
    vi.advanceTimersByTime(1000)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ breadcrumbs: [{ message: 'only-b' }] })
  })

  it('同一个插件对象装到两个实例，计时状态仍各自独立', () => {
    const plugin = whiteScreenPlugin()
    const a = start(plugin)
    vi.advanceTimersByTime(1000)
    start(plugin)
    vi.advanceTimersByTime(1000)
    expect(events).toHaveLength(1)
    a.monitor.destroy()
    vi.advanceTimersByTime(1000)
    expect(events).toHaveLength(2)
  })

  it('创建插件时复制配置，不受调用方后续修改影响', () => {
    const mask = document.createElement('div')
    mask.className = 'mask'
    hitTest.mockReturnValue([mask, document.body])
    const options: WhiteScreenOptions = {
      blankSelectors: ['body'],
      ignoreSelectors: ['.mask'],
      blankRatio: 0.7,
      recheckIntervalMs: 250,
    }
    const plugin = whiteScreenPlugin(options)
    options.blankSelectors!.length = 0
    options.ignoreSelectors!.length = 0
    options.blankRatio = 1
    options.recheckIntervalMs = 100000
    start(plugin)
    vi.advanceTimersByTime(249)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toHaveLength(1)
  })

  it('组合插件转交白屏配置，顶层配置不再声明旧名单', () => {
    const plugins = stabilityPlugins({ whiteScreen: { blankRatio: 0.7, recheckIntervalMs: 250 } })
    expect(plugins.map((plugin) => plugin.name)).toEqual([
      'stability:white-screen',
      'stability:stutter',
      'stability:crash',
    ])
    const { ctx } = start(plugins[0])
    expect(ctx.config).not.toHaveProperty('containerElements')
    expect(ctx.config).not.toHaveProperty('skeletonElements')
    vi.advanceTimersByTime(250)
    expect(events).toHaveLength(1)
  })

  it.each([0, -1, NaN, Infinity])('拒绝非法时间参数 %s', (value) => {
    expect(() => whiteScreenPlugin({ recheckIntervalMs: value })).toThrow(RangeError)
  })

  it.each([-0.1, 1, 1.1, NaN, Infinity])('拒绝非法空白比例 %s', (value) => {
    expect(() => whiteScreenPlugin({ blankRatio: value })).toThrow(RangeError)
  })

  it('比例可以配置为 0，此时至少一个空白点且两次满足才上报', () => {
    sampleWithBlankCount(0)
    start(whiteScreenPlugin({ blankRatio: 0 }))
    vi.advanceTimersByTime(2000)
    expect(events).toEqual([])
    sampleWithBlankCount(1)
    vi.advanceTimersByTime(2000)
    expect(events).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(events).toHaveLength(1)
  })

  it.each(['blankSelectors', 'ignoreSelectors'] as const)(
    '安装时拒绝非法 %s，未留下定时器',
    (key) => {
      expect(() => start(whiteScreenPlugin({ [key]: ['['] }))).toThrow()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('浏览器不支持命中测试时不启动检测', () => {
    Reflect.deleteProperty(document, 'elementsFromPoint')
    start()
    vi.advanceTimersByTime(10000)
    expect(events).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
