import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfig } from '../src/common/config'
import { stallPlugin } from '../src/aiPerformance/stall'
import instrumentFetch from '../src/performance/fetch'
import instrumentXHR from '../src/performance/xhr'
import type { MonitorContext } from '../src/types'
import { visible } from './helpers'

let cleanups: (() => void)[]
beforeEach(() => {
  cleanups = []
  visible(true)
})
afterEach(() => {
  cleanups.reverse().forEach((cleanup) => cleanup())
})

function context(): MonitorContext {
  const config = createConfig({ url: 'http://localhost:3000/telemetry' })
  return {
    config,
    getConfig: () => config,
    report: vi.fn(),
    getPlugin: () => undefined,
    events: { on: () => () => {}, off: () => {}, emit: () => {} },
    provide: () => {},
    consume: () => undefined,
    getBehaviorState: () => [],
    getRecordScreenData: () => '',
    addDispose: (dispose) => {
      cleanups.push(dispose)
      return dispose
    },
    on(target, type, listener, options) {
      target.addEventListener(type, listener, options)
      const dispose = () => target.removeEventListener(type, listener, options)
      cleanups.push(dispose)
      return dispose
    },
  }
}

describe('Fetch 业务隔离', () => {
  it('report 抛错不把成功请求变成失败，不读取 Response body', async () => {
    const response = new Response('business body', { status: 200 })
    const original = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', original)
    const ctx = context()
    ctx.report = () => {
      throw new Error('monitor failure')
    }
    cleanups.push(instrumentFetch(ctx))
    expect(await window.fetch('/business')).toBe(response)
    expect(response.bodyUsed).toBe(false)
    expect(await response.text()).toBe('business body')
  })

  it('原始请求拒绝时仍返回同一个异常对象', async () => {
    const businessError = new Error('business failure')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(businessError))
    const ctx = context()
    ctx.report = () => {
      throw new Error('monitor failure')
    }
    cleanups.push(instrumentFetch(ctx))
    await expect(window.fetch('/business')).rejects.toBe(businessError)
  })

  it('参数采集抛错时不阻断业务请求', async () => {
    const response = new Response(null, { status: 200 })
    const original = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', original)
    const ctx = context()
    ctx.getConfig = () => {
      throw new Error('metadata failed')
    }
    cleanups.push(instrumentFetch(ctx))
    expect(await window.fetch('/business')).toBe(response)
    expect(ctx.report).not.toHaveBeenCalled()
  })

  it('保留 this、input 和 init，不把 SDK 自身请求再次采集', async () => {
    const original = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', original)
    const ctx = context()
    cleanups.push(instrumentFetch(ctx))
    const init = { method: 'POST', body: 'data' }
    await window.fetch('/telemetry', init)
    expect(original.mock.contexts[0]).toBe(window)
    expect(original.mock.calls[0]).toEqual(['/telemetry', init])
    expect(ctx.report).not.toHaveBeenCalled()
  })

  it('多个实例可乱序销毁，销毁后的实例不再报告并最终恢复原生 Fetch', async () => {
    const original = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', original)
    const a = context(),
      b = context()
    const disposeA = instrumentFetch(a),
      disposeB = instrumentFetch(b)
    cleanups.push(disposeA, disposeB)
    disposeA()
    await window.fetch('/business')
    expect(a.report).not.toHaveBeenCalled()
    expect(b.report).toHaveBeenCalledTimes(1)
    disposeB()
    expect(window.fetch).toBe(original)
  })

  it('销毁时仍在途的业务 Fetch 不再产生监控事件', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done
          }),
      ),
    )
    const ctx = context()
    const dispose = instrumentFetch(ctx)
    const request = window.fetch('/business')
    dispose()
    resolve(new Response())
    await request
    expect(ctx.report).not.toHaveBeenCalled()
  })
})

describe('卡顿采集', () => {
  it('后台无任何 rAF 回调，切回后的第一帧不报告假卡顿；前台真卡顿仍报告', () => {
    let nextFrame!: FrameRequestCallback
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        nextFrame = callback
        return 42
      }),
    )
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const ctx = context()
    stallPlugin({ reportInterval: 1 }).setup(ctx)
    nextFrame(1000)
    visible(false)
    document.dispatchEvent(new Event('visibilitychange'))
    // 模拟后台一分钟内没有执行任何一帧。
    visible(true)
    document.dispatchEvent(new Event('visibilitychange'))
    nextFrame(61000)
    expect(ctx.report).not.toHaveBeenCalled()
    nextFrame(61200)
    expect(ctx.report).toHaveBeenCalledTimes(1)
    expect(ctx.report).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ message: 'raf_gap 持续 200ms' }),
      }),
    )
    cleanups.forEach((cleanup) => cleanup())
    expect(cancel).toHaveBeenCalledWith(42)
  })

  it('一次上报失败不停止后续帧调度', () => {
    let nextFrame!: FrameRequestCallback
    const raf = vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const ctx = context()
    ctx.report = () => {
      throw new Error('report')
    }
    stallPlugin({ reportInterval: 1 }).setup(ctx)
    nextFrame(1000)
    expect(() => nextFrame(2000)).not.toThrow()
    expect(raf).toHaveBeenCalledTimes(3)
  })
})

describe('XHR', () => {
  it('上报错误不冒泡为页面错误，销毁后清理尚未完成请求的监听器', () => {
    vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {})
    const ctx = context()
    ctx.report = vi.fn(() => {
      throw new Error('report')
    })
    const dispose = instrumentXHR(ctx)
    cleanups.push(dispose)
    const request = new XMLHttpRequest()
    request.open('GET', '/business')
    request.send()
    expect(() => request.dispatchEvent(new Event('loadend'))).not.toThrow()
    expect(ctx.report).toHaveBeenCalledTimes(1)
    const pending = new XMLHttpRequest()
    pending.open('GET', '/business')
    pending.send()
    dispose()
    pending.dispatchEvent(new Event('loadend'))
    expect(ctx.report).toHaveBeenCalledTimes(1)
  })
})
