import { act, createElement, type ComponentType, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMonitor, type Monitor } from '../src/core'
import * as errorPlugins from '../src/error'
import { jsErrorPlugin, reactErrorPlugin, vueErrorPlugin } from '../src/error'
import type { Vue } from '../src/error/vueError'
import type { ExceptionErrorEvent, MonitorEvent, MonitorPlugin } from '../src/types'
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
let roots: Root[] = []
beforeEach(() => {
  events.length = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  await act(async () => {
    roots.forEach((root) => root.unmount())
  })
  roots = []
  monitors.reverse().forEach((monitor) => monitor.destroy())
  monitors = []
  document.body.replaceChildren()
})

function start(plugins: MonitorPlugin[] = []) {
  const test = capture()
  const monitor = createMonitor({ url: '/collect', plugins: [test.plugin, ...plugins] })
  monitors.push(monitor)
  return { monitor, ctx: test.context() }
}

function exceptionEvent(index = events.length - 1): ExceptionErrorEvent {
  const event = events[index]
  if (event?.category !== 'error' || !('exception' in event.payload)) {
    throw new Error('expected an exception event')
  }
  return event as ExceptionErrorEvent
}

function reject(reason: unknown) {
  // happy-dom 没有 PromiseRejectionEvent；真实浏览器用例另测原生拒绝通知。
  const event = new Event('unhandledrejection', { cancelable: true })
  Object.defineProperty(event, 'reason', { value: reason })
  window.dispatchEvent(event)
  return event
}

describe('三个错误插件的入口与生命周期', () => {
  it('只导出三个插件，未安装时不采集错误', () => {
    expect(Object.keys(errorPlugins).sort()).toEqual([
      'jsErrorPlugin',
      'reactErrorPlugin',
      'vueErrorPlugin',
    ])
    start()
    window.dispatchEvent(new ErrorEvent('error', { message: 'not installed' }))
    expect(events).toEqual([])
  })

  it('JS 插件重复安装只注册两个监听器，销毁后移除它们', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { monitor } = start([jsErrorPlugin(), jsErrorPlugin()])
    monitor.use(jsErrorPlugin())
    expect(add.mock.calls.filter(([type]) => type === 'error')).toHaveLength(1)
    expect(add.mock.calls.filter(([type]) => type === 'unhandledrejection')).toHaveLength(1)
    window.dispatchEvent(new ErrorEvent('error', { message: 'once' }))
    reject('once')
    expect(events).toHaveLength(2)
    monitor.destroy()
    monitor.destroy()
    expect(remove.mock.calls.filter(([type]) => type === 'error')).toHaveLength(1)
    expect(remove.mock.calls.filter(([type]) => type === 'unhandledrejection')).toHaveLength(1)
    window.dispatchEvent(new ErrorEvent('error', { message: 'after destroy' }))
    reject('after destroy')
    expect(events).toHaveLength(2)
  })

  it('不同实例各自读取诊断快照，销毁一个不影响另一个', () => {
    const a = start([jsErrorPlugin()])
    const b = start([jsErrorPlugin()])
    a.monitor.addBreadcrumb({ category: 'custom', message: 'only-a' })
    b.monitor.addBreadcrumb({ category: 'custom', message: 'only-b' })
    a.ctx.provide('replay:data', () => 'recording-a')
    window.dispatchEvent(new ErrorEvent('error', { message: 'both' }))
    expect(exceptionEvent(0).breadcrumbs[0].message).toBe('only-a')
    expect(exceptionEvent(0).replayData).toBe('recording-a')
    expect(exceptionEvent(1).breadcrumbs[0].message).toBe('only-b')
    expect(exceptionEvent(1).replayData).toBeUndefined()
    a.monitor.addBreadcrumb({ category: 'custom', message: 'later' })
    expect(exceptionEvent(0).breadcrumbs).toHaveLength(1)
    a.monitor.destroy()
    window.dispatchEvent(new ErrorEvent('error', { message: 'only-b-alive' }))
    expect(events).toHaveLength(3)
    expect(exceptionEvent().breadcrumbs[0].message).toBe('only-b')
  })
})

describe('浏览器原生错误', () => {
  it('一个插件覆盖 JS、受限脚本、资源和 Promise，保留各自协议', () => {
    const { monitor, ctx } = start([jsErrorPlugin()])
    monitor.addBreadcrumb({ category: 'custom', message: 'before-error' })
    ctx.provide('replay:data', () => 'compressed-recording')
    const error = new TypeError('failed')
    error.stack = 'TypeError: failed\n    at render (https://example.com/app.js:12:7)'
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }))
    const image = document.createElement('img')
    image.src = '/missing.png'
    document.body.append(image)
    image.dispatchEvent(new Event('error'))
    const rejection = reject(error)
    expect(events.map((event) => event.eventType)).toEqual([
      'js_error',
      'cors_error',
      'resource_error',
      'unhandled_rejection',
    ])
    expect(exceptionEvent(0).payload).toEqual({
      exception: {
        name: 'TypeError',
        message: 'failed',
        stack: [
          {
            filename: 'https://example.com/app.js',
            functionName: 'render',
            line: 12,
            column: 7,
          },
        ],
      },
      mechanism: { type: 'window.onerror', handled: false },
    })
    expect(exceptionEvent(1).payload.exception).toEqual({
      name: 'Error',
      message: 'Script error.',
      stack: [],
    })
    expect(events[2].payload).toMatchObject({
      message: 'IMG load error',
      resource: { url: image.src, tagName: 'IMG' },
      mechanism: { type: 'resource.error', handled: false },
    })
    expect(exceptionEvent(3).payload.exception).toEqual(exceptionEvent(0).payload.exception)
    expect(exceptionEvent(3).payload.mechanism).toEqual({
      type: 'unhandledrejection',
      handled: false,
    })
    expect(rejection.defaultPrevented).toBe(false)
    for (const event of events) {
      expect(event).toMatchObject({
        schemaVersion: 2,
        category: 'error',
        level: 'error',
        replayData: 'compressed-recording',
      })
      expect((event as ExceptionErrorEvent).breadcrumbs[0].message).toBe('before-error')
      expect(event.eventId).toBeTruthy()
    }
    expect(new Set(events.map((event) => event.eventId)).size).toBe(4)
  })

  it.each(['missing', 'empty'] as const)('没有可解析堆栈时使用 ErrorEvent 位置：%s', (kind) => {
    start([jsErrorPlugin()])
    const error = kind === 'empty' ? new Error('broken') : undefined
    if (error) error.stack = ''
    window.dispatchEvent(
      new ErrorEvent('error', {
        error,
        message: 'broken',
        filename: 'https://example.com/no-stack.js',
        lineno: 18,
        colno: 3,
      }),
    )
    expect(exceptionEvent().payload.exception.stack).toEqual([
      { filename: 'https://example.com/no-stack.js', line: 18, column: 3 },
    ])
  })

  it('信息受限的脚本错误不伪造调用栈，也不重复归类为普通 JS 错误', () => {
    start([jsErrorPlugin()])
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'Script error.',
        filename: 'https://example.com/remote.js',
        lineno: 1,
      }),
    )
    expect(events).toHaveLength(1)
    expect(exceptionEvent().eventType).toBe('cors_error')
    expect(exceptionEvent().payload.exception.stack).toEqual([
      { filename: 'https://example.com/remote.js', line: 1, column: undefined },
    ])
  })

  it('捕获不冒泡的资源错误，不把无资源地址的普通事件当成错误', () => {
    start([jsErrorPlugin()])
    const link = document.createElement('link')
    link.href = '/missing.css'
    document.body.append(link)
    link.dispatchEvent(new Event('error'))
    document.body.dispatchEvent(new Event('error'))
    window.dispatchEvent(new Event('error'))
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ resource: { url: link.href, tagName: 'LINK' } })
  })

  it.each([
    ['string', 'rejected', 'rejected'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['number', 42, '42'],
    ['object', { detail: 'failed' }, '{"detail":"failed"}'],
    ['bigint', BigInt(10), '10'],
    ['symbol', Symbol('reason'), 'Symbol(reason)'],
  ])('将非 Error 拒绝原因转成可上报字符串：%s', (_label, reason, message) => {
    start([jsErrorPlugin()])
    reject(reason)
    expect(exceptionEvent().payload.exception).toEqual({
      name: 'UnhandledRejection',
      message,
      stack: [],
    })
  })

  it('循环对象和不可字符串化的拒绝原因不会让采集器抛错', () => {
    start([jsErrorPlugin()])
    const circular: Record<string, unknown> = {}
    circular.self = circular
    reject(circular)
    expect(exceptionEvent().payload.exception.message).toBe('[object Object]')
    reject({
      toJSON() {
        throw new Error('json')
      },
      toString() {
        throw new Error('string')
      },
    })
    expect(exceptionEvent().payload.exception).toEqual({
      name: 'UnhandledRejection',
      message: 'Unknown error',
      stack: [],
    })
  })
})

describe('React 错误插件', () => {
  it('组件类型只创建一次，错误边界实际捕获渲染错误并显示 Fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { monitor, ctx } = start([jsErrorPlugin(), reactErrorPlugin()])
    monitor.addBreadcrumb({ category: 'custom', message: 'open-profile' })
    ctx.provide('replay:data', () => 'react-recording')
    type BoundaryProps = {
      children: ReactNode
      Fallback: ComponentType<{ error: ExceptionErrorEvent | null }>
    }
    const Boundary = monitor.getCapability<ComponentType<BoundaryProps>>('error:react-boundary')!
    expect(Boundary).toBeTypeOf('function')
    monitor.use(reactErrorPlugin())
    expect(monitor.getCapability('error:react-boundary')).toBe(Boundary)
    const Fallback = ({ error }: { error: ExceptionErrorEvent | null }) =>
      createElement('p', null, error?.payload.exception.message || 'loading')
    const error = new TypeError('render failed')
    function Broken(): ReactNode {
      throw error
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(createElement(Boundary, { Fallback, children: createElement(Broken) }))
    })
    const captured = events.filter(
      (event) => event.eventType === 'react_error',
    ) as ExceptionErrorEvent[]
    expect(captured).toHaveLength(1)
    expect(container.textContent).toBe('render failed')
    expect(captured[0]).toMatchObject({
      replayData: 'react-recording',
      payload: {
        exception: { name: 'TypeError', message: 'render failed' },
        mechanism: { type: 'react.error_boundary', handled: true },
      },
    })
    expect(captured[0].payload.component?.stack).toContain('Broken')
    expect(captured[0].breadcrumbs[0].message).toBe('open-profile')
    window.dispatchEvent(new ErrorEvent('error', { message: 'outside-boundary' }))
    expect(events.filter((event) => event.eventType === 'js_error')).toHaveLength(1)
  })
})

describe('Vue 错误插件', () => {
  it('保留组件信息、诊断字段和原处理器，销毁后恢复原处理器', () => {
    const original = vi.fn()
    const app: Vue = { config: { errorHandler: original } }
    const { monitor, ctx } = start([vueErrorPlugin(app)])
    ctx.provide('replay:data', () => 'vue-recording')
    monitor.addBreadcrumb({ category: 'custom', message: 'open-settings' })
    const installed = app.config.errorHandler!
    monitor.use(vueErrorPlugin(app))
    expect(app.config.errorHandler).toBe(installed)
    const error = new TypeError('vue failed')
    const instance = { $options: { name: 'Settings', __file: '/src/Settings.vue' } }
    installed(error, instance, 'render function')
    expect(exceptionEvent()).toMatchObject({
      eventType: 'vue_error',
      replayData: 'vue-recording',
      payload: {
        exception: { name: 'TypeError', message: 'vue failed' },
        mechanism: { type: 'vue.error_handler', handled: true },
        component: { name: '<Settings>', file: '/src/Settings.vue', stack: 'render function' },
      },
    })
    expect(exceptionEvent().breadcrumbs[0].message).toBe('open-settings')
    expect(original).toHaveBeenCalledExactlyOnceWith(error, instance, 'render function')
    monitor.destroy()
    expect(app.config.errorHandler).toBe(original)
    installed(error, instance, 'late callback')
    expect(events).toHaveLength(1)
  })

  it('没有 $options 时仍可提取组件信息，非 Error 值不伪造 SDK 堆栈', () => {
    const app: Vue = { config: {} }
    start([vueErrorPlugin(app)])
    app.config.errorHandler!(
      { detail: 'vue reason' },
      { type: { __name: 'Profile', __file: '/src/Profile.vue' } },
      'setup function',
    )
    expect(exceptionEvent().payload).toMatchObject({
      exception: { name: 'Error', message: '{"detail":"vue reason"}', stack: [] },
      component: { name: '<Profile>', file: '/src/Profile.vue', stack: 'setup function' },
    })
    app.config.errorHandler!(undefined, null, 'unknown')
    expect(exceptionEvent().payload.exception.message).toBe('undefined')
    expect(exceptionEvent().payload.component?.name).toBe('<Anonymous>')
  })

  it('销毁时不覆盖业务后来替换的错误处理器', () => {
    const app: Vue = { config: {} }
    const { monitor } = start([vueErrorPlugin(app)])
    const replacement = vi.fn()
    app.config.errorHandler = replacement
    monitor.destroy()
    expect(app.config.errorHandler).toBe(replacement)
  })
})
