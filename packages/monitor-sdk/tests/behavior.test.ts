import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMonitor, type Monitor } from '../src/core'
import { behaviorPlugins, clickPlugin, navigationPlugin, pvPlugin } from '../src/behavior'
import type { MonitorContext, MonitorEvent, MonitorPlugin } from '../src/types'
import { capture } from './helpers'

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

let monitors: Monitor[] = []
beforeEach(() => {
  vi.useFakeTimers()
  history.replaceState(null, '', '/start')
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
  events.length = 0
})
afterEach(() => {
  monitors.reverse().forEach((monitor) => monitor.destroy())
  monitors = []
  document.body.replaceChildren()
  vi.useRealTimers()
})

function start(plugins: MonitorPlugin[] = []) {
  const test = capture()
  const monitor = createMonitor({ url: '/collect', plugins: [test.plugin, ...plugins] })
  monitors.push(monitor)
  return { monitor, ctx: test.context() }
}

describe('行为插件职责', () => {
  it('默认组合不启动录屏，手动 API 不依赖行为插件', () => {
    const { monitor, ctx } = start()
    expect(behaviorPlugins().map((plugin) => plugin.name)).toEqual([
      'behavior:navigation',
      'behavior:pv',
      'behavior:click',
    ])
    expect(ctx.getReplayData()).toBe('')
    monitor.addBreadcrumb({ category: 'custom', message: '生成开始' })
    monitor.track('generation_started', { model: 'demo', token: 'secret' })
    expect(ctx.getBreadcrumbs()).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(events[0].payload).toEqual({
      message: 'generation_started',
      data: { name: 'generation_started', attributes: { model: 'demo' } },
    })
    monitor.track('  ')
    expect(events).toHaveLength(1)
    monitor.destroy()
    monitor.track('after_destroy')
    monitor.addBreadcrumb({ category: 'custom', message: 'after_destroy' })
    ctx.addBreadcrumb({ category: 'custom' })
    expect(ctx.getBreadcrumbs()).toEqual([])
    expect(events).toHaveLength(1)
  })

  it('不同实例不共享轨迹，并将错误读取到的上下文固定为快照', () => {
    const a = start(),
      b = start()
    a.monitor.addBreadcrumb({ category: 'custom', message: 'only-a' })
    expect(b.ctx.getBreadcrumbs()).toEqual([])
    const before = a.ctx.getBreadcrumbs()
    a.monitor.addBreadcrumb({ category: 'custom', message: 'later' })
    expect(before.map((item) => item.message)).toEqual(['only-a'])
  })
})

describe('点击', () => {
  it('直接采集 event.target，保留 span/svg 子节点，普通 div 也采集', () => {
    const { ctx } = start([clickPlugin()])
    document.body.innerHTML =
      '<button data-monitor-id="save"><span>private text</span><svg><path /></svg></button><div id="long"></div>'
    document
      .querySelector('span')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    document
      .querySelector('path')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    const long = document.getElementById('long')!
    long.textContent = 'x'.repeat(10000)
    long.click()
    document.querySelector('button')!.click()
    expect(events).toHaveLength(4)
    expect(events[0].payload).toMatchObject({
      message: 'click span',
      data: { tagName: 'SPAN', path: expect.stringMatching(/span:nth-of-type\(1\)$/) },
    })
    expect(events[0].payload).toMatchObject({ data: { monitorId: undefined } })
    expect(events[1].payload).toMatchObject({
      message: 'click path',
      data: {
        tagName: document.querySelector('path')!.tagName,
        path: expect.stringMatching(/path:nth-of-type\(1\)$/),
      },
    })
    expect(events[2].payload).toMatchObject({ message: 'click div', data: { tagName: 'DIV' } })
    expect(events[3].payload).toMatchObject({
      message: 'click save',
      data: { tagName: 'BUTTON', monitorId: 'save' },
    })
    expect(JSON.stringify(events)).not.toContain('private text')
    expect(JSON.stringify(events)).not.toContain('x'.repeat(10000))
    expect(ctx.getBreadcrumbs()).toHaveLength(4)
  })

  it('忽略没有 Element 目标的事件，不读取表单 value', () => {
    start([clickPlugin({ captureText: true })])
    window.dispatchEvent(new MouseEvent('click'))
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(events).toEqual([])
    document.body.innerHTML = '<input type="text" value="secret-input-value">'
    document.querySelector('input')!.click()
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ data: { tagName: 'INPUT' } })
    expect(JSON.stringify(events)).not.toContain('secret-input-value')
  })

  it('忽略敏感区域，可选文本截断；点击轨迹在业务错误之前可读', () => {
    const { ctx } = start([clickPlugin({ captureText: true })])
    document.body.innerHTML =
      '<section data-monitor-ignore><button>secret</button></section><button id="public"></button><input data-monitor-id="password" type="password" value="secret">'
    document
      .querySelector('section button')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    document
      .querySelector('input')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    expect(events).toEqual([])
    const button = document.getElementById('public')!
    button.textContent = 'x'.repeat(1000)
    let atClick: ReturnType<MonitorContext['getBreadcrumbs']> = []
    button.addEventListener('click', () => {
      atClick = ctx.getBreadcrumbs()
    })
    button.click()
    expect(events[0].payload).toMatchObject({ data: { textContent: 'x'.repeat(120) } })
    expect(atClick).toHaveLength(1)
  })

  it('保留 Shadow DOM 在 window 上暴露的 event.target，销毁后移除监听', () => {
    const { monitor } = start([clickPlugin()])
    const host = document.createElement('div')
    host.setAttribute('data-monitor-id', 'shadow-host')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<button data-monitor-id="shadow"><span>save</span></button>'
    const received: { target?: Element } = {}
    window.addEventListener(
      'click',
      (event) => {
        if (event.target instanceof Element) received.target = event.target
      },
      { capture: true, once: true },
    )
    const click = () =>
      root
        .querySelector('span')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    click()
    expect(events).toHaveLength(1)
    // DOM 模拟器的 Shadow 重定向有差异；宿主节点的具体结果由真实浏览器回归验证。
    expect(received.target).toBeInstanceOf(Element)
    expect(events[0].payload).toMatchObject({
      data: {
        tagName: received.target?.tagName,
        monitorId: received.target?.getAttribute('data-monitor-id') ?? undefined,
      },
    })
    monitor.destroy()
    click()
    expect(events).toHaveLength(1)
  })

  it('排除祖先和开放 Shadow DOM 内的敏感区域，不采集含敏感后代的文本', () => {
    start([clickPlugin({ captureText: true })])
    document.body.innerHTML =
      '<div class="rr-block"><span>secret</span></div><div contenteditable="true"><span>secret</span></div><div id="container">public<span data-monitor-ignore>secret</span></div>'
    document.querySelectorAll('span').forEach((span) => span.click())
    const host = document.createElement('div')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<section class="rr-ignore"><span>secret</span></section>'
    root
      .querySelector('span')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    expect(events).toEqual([])
    document.getElementById('container')!.click()
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ data: { tagName: 'DIV' } })
    expect(events[0].payload).toMatchObject({ data: { textContent: undefined } })
  })
})

describe('导航与 PV', () => {
  it('通过 window 监听 History 事件，单个实例的采集异常不影响其他实例', () => {
    const a = start([navigationPlugin()])
    const b = start([navigationPlugin()])
    vi.spyOn(a.monitor, 'addBreadcrumb').mockImplementation(() => {
      throw new Error('breadcrumb failed')
    })
    expect(() => history.pushState(null, '', '/next')).not.toThrow()
    expect(b.ctx.getBreadcrumbs()).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ data: { jumpType: 'pushState' } })
    a.monitor.destroy()
    b.monitor.destroy()
    // 即使页面上还有其他来源的同名自定义事件，已销毁实例也不再处理。
    history.replaceState(null, '', '/after-destroy')
    window.dispatchEvent(new Event('pushstate'))
    window.dispatchEvent(new Event('replacestate'))
    expect(events).toHaveLength(1)
  })

  it('初次 PV 只发送一次，更新 state/query 不增加 PV', () => {
    start([navigationPlugin(), pvPlugin()])
    vi.runOnlyPendingTimers()
    expect(events.map((event) => event.eventType)).toEqual(['page_view'])
    history.replaceState({ value: 1 }, '', location.href)
    history.pushState(null, '', '/start?token=secret')
    expect(events).toHaveLength(1)
    history.pushState(null, '', '/next?token=secret')
    expect(events.map((event) => event.eventType)).toEqual([
      'page_view',
      'route_change',
      'page_view',
    ])
    expect(JSON.stringify(events)).not.toContain('secret')
    window.dispatchEvent(new Event('pageshow'))
    expect(events).toHaveLength(3)
  })

  it('同一次 popstate/hashchange 去重，返回原页面仍记录一次', () => {
    const { ctx } = start([navigationPlugin(), pvPlugin()])
    vi.runOnlyPendingTimers()
    location.hash = '#/next'
    window.dispatchEvent(new Event('popstate'))
    window.dispatchEvent(new Event('hashchange'))
    expect(events.filter((event) => event.eventType === 'route_change')).toHaveLength(1)
    expect(ctx.getBreadcrumbs()).toHaveLength(1)
    history.replaceState(null, '', '/start')
    expect(events.filter((event) => event.eventType === 'route_change')).toHaveLength(2)
  })

  it('异步初始 PV 在销毁后取消，导航发生于初始回调前不重复', () => {
    const first = start([navigationPlugin(), pvPlugin()])
    first.monitor.destroy()
    vi.runOnlyPendingTimers()
    expect(events).toEqual([])
    start([navigationPlugin(), pvPlugin()])
    history.pushState(null, '', '/early')
    vi.runOnlyPendingTimers()
    expect(events.map((event) => event.eventType)).toEqual(['route_change', 'page_view'])
  })

  it('多个实例乱序销毁，最后恢复 History；原方法抛错不产生导航', () => {
    const original = history.pushState
    const a = start([navigationPlugin()]),
      b = start([navigationPlugin()])
    a.monitor.destroy()
    history.pushState(null, '', '/only-b')
    expect(a.ctx.getBreadcrumbs()).toEqual([])
    expect(b.ctx.getBreadcrumbs()).toHaveLength(1)
    expect(events).toHaveLength(1)
    b.monitor.destroy()
    expect(history.pushState).toBe(original)
    const error = new Error('history failed')
    vi.spyOn(history, 'pushState').mockImplementation(() => {
      throw error
    })
    start([navigationPlugin()])
    expect(() => history.pushState(null, '', '/failed')).toThrow(error)
    expect(events).toHaveLength(1)
  })
})
