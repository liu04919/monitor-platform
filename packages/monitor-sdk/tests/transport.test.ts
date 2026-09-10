import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Monitor } from '../src/core'
import type { ConfigType } from '../src/types'
import { browser, capture, event, eventually, visible } from './helpers'

let monitors: Monitor[]
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>
const config = {
  url: 'https://monitor.test/events',
  appId: 'project-a',
  publicKey: 'pk_a',
  projectName: 'A',
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  })
  browser()
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }))
  vi.stubGlobal('fetch', fetcher)
  monitors = []
})

afterEach(() => {
  monitors.forEach((monitor) => monitor.destroy())
  vi.useRealTimers()
})

async function setup(options: Partial<ConfigType> = {}) {
  const { createMonitor } = await import('../src/core')
  const captured = capture()
  const monitor = createMonitor({ ...config, ...options, plugins: [captured.plugin] })
  monitors.push(monitor)
  return { monitor, ctx: captured.context() }
}

function payload(index = 0) {
  return JSON.parse(fetcher.mock.calls[index][1]!.body as string)
}

describe('实例与生命周期', () => {
  it('异步插件在销毁后才注册的清理函数也会立即执行', async () => {
    const { monitor, ctx } = await setup()
    const cleanup = vi.fn()
    monitor.destroy()
    await Promise.resolve()
    ctx.addDispose(cleanup)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
  it('配置、事件队列与成功回调不会跨项目串用', async () => {
    const successA = vi.fn(),
      successB = vi.fn()
    const a = await setup({ reportSuccess: successA })
    const b = await setup({
      appId: 'project-b',
      url: 'https://other.test/events',
      publicKey: 'pk_b',
      reportSuccess: successB,
    })
    a.ctx.report(event('a'))
    b.ctx.report(event('b'))
    await Promise.all([a.monitor.flush(), b.monitor.flush()])
    expect(a.ctx.getConfig().appId).toBe('project-a')
    expect(fetcher.mock.calls.map((args) => args[0]).sort()).toEqual([
      'https://monitor.test/events',
      'https://other.test/events',
    ])
    expect(successA.mock.calls[0][0][0].eventId).toBe('a')
    expect(successB.mock.calls[0][0][0].eventId).toBe('b')
  })

  it('销毁一个实例不停止另一个实例，销毁后不再调用用户回调', async () => {
    const success = vi.fn()
    const a = await setup({ reportSuccess: success })
    const b = await setup({ appId: 'b' })
    a.ctx.report(event('a'))
    a.monitor.destroy()
    a.ctx.report(event('ignored'))
    b.ctx.report(event('b'))
    await b.monitor.flush()
    expect(success).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(payload().app.id).toBe('b')
  })

  it('插件清理抛错不阻断剩余清理，并且重复 destroy 是安全的', async () => {
    const { monitor } = await setup()
    const cleanup = vi.fn()
    monitor.use({ name: 'first', setup: () => cleanup })
    monitor.use({
      name: 'second',
      setup: () => () => {
        throw new Error('cleanup')
      },
    })
    expect(() => {
      monitor.destroy()
      monitor.destroy()
    }).not.toThrow()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('入队后业务或回调修改对象都不能改变批次；异步回调失败不引起重传', async () => {
    const failure = vi.fn()
    const { monitor, ctx } = await setup({
      reportBefore(events) {
        events[0].eventId = 'mutated'
        throw new Error('before')
      },
      reportSuccess: async () => {
        throw new Error('callback')
      },
      reportAfter: () => {
        throw new Error('after')
      },
      reportFail: failure,
    })
    const original = event('original')
    ctx.report(original)
    original.eventId = 'changed'
    await monitor.flush()
    await monitor.flush()
    expect(payload().events[0].eventId).toBe('original')
    expect(failure).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('发送与重试', () => {
  it('浏览器明确离线时只保留队列，恢复在线后发送且不消耗重试额度', async () => {
    const { monitor, ctx } = await setup({ transport: { maxRetries: 0 } })
    await monitor.flush()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    ctx.report(event('offline'))
    await monitor.flush()
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetcher).not.toHaveBeenCalled()
    online.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await monitor.flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('Fetch 即使以 undefined 拒绝，也不能误判为成功', async () => {
    fetcher.mockRejectedValueOnce(undefined)
    const failure = vi.fn(),
      success = vi.fn()
    const { monitor, ctx } = await setup({ reportFail: failure, reportSuccess: success })
    ctx.report(event())
    await monitor.flush()
    expect(failure).toHaveBeenCalledTimes(1)
    expect(success).not.toHaveBeenCalled()
  })

  it('销毁中止在途监控请求，原批次保留供后续实例恢复', async () => {
    fetcher.mockImplementationOnce(() => new Promise(() => {}))
    const failure = vi.fn()
    const a = await setup({ reportFail: failure })
    a.ctx.report(event('aborted'))
    const flushed = a.monitor.flush()
    await eventually(() => fetcher.mock.calls.length === 1)
    a.monitor.destroy()
    await flushed
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true)
    expect(failure).not.toHaveBeenCalled()
    const b = await setup()
    await b.monitor.flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(payload(0).batchId).toBe(payload(1).batchId)
  })
  it('超时主动中止请求，随后能发送下一个批次', async () => {
    fetcher.mockImplementationOnce(() => new Promise(() => {}))
    const { monitor, ctx } = await setup({ batchSize: 1, transport: { requestTimeoutMs: 100 } })
    ctx.report(event('first'))
    ctx.report(event('second'))
    const flushed = monitor.flush()
    await eventually(() => fetcher.mock.calls.length === 1)
    await vi.advanceTimersByTimeAsync(100)
    await flushed
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(payload(1).events[0].eventId).toBe('second')
  })

  it('IndexedDB 不可用时，内存重试保持 batchId、sentAt 和内容不变', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    fetcher.mockRejectedValueOnce(new TypeError('offline'))
    const { monitor, ctx } = await setup()
    ctx.report(event())
    await monitor.flush()
    const first = payload()
    await vi.advanceTimersByTimeAsync(1000)
    await monitor.flush()
    expect(payload(1)).toEqual(first)
  })

  it('400/413 不重试，429/500 仍保留原批次等待重试', async () => {
    const drop = vi.fn()
    fetcher.mockResolvedValueOnce(new Response(null, { status: 413 }))
    const { monitor, ctx } = await setup({ reportDrop: drop })
    ctx.report(event())
    await monitor.flush()
    await monitor.flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(drop).toHaveBeenCalledWith(expect.objectContaining({ reason: 'http_rejected' }))
    fetcher.mockResolvedValueOnce(new Response(null, { status: 429 }))
    ctx.report(event())
    await monitor.flush()
    await vi.advanceTimersByTimeAsync(1000)
    await monitor.flush()
    expect(payload(2).batchId).toBe(payload(1).batchId)
  })

  it('超过重试次数后丢弃，不形成无限请求', async () => {
    fetcher.mockRejectedValue(new TypeError('offline'))
    const drop = vi.fn()
    const { monitor, ctx } = await setup({ transport: { maxRetries: 1 }, reportDrop: drop })
    ctx.report(event())
    await monitor.flush()
    await vi.advanceTimersByTimeAsync(1000)
    await monitor.flush()
    await monitor.flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(drop).toHaveBeenCalledWith(expect.objectContaining({ reason: 'retries_exhausted' }))
  })

  it('同一项目两个实例恢复离线批次时，仅一个消费者取得任务', async () => {
    fetcher.mockRejectedValueOnce(new Error('offline'))
    const a = await setup()
    a.ctx.report(event('once'))
    await a.monitor.flush()
    a.monitor.destroy()
    vi.setSystemTime(Date.now() + 2000)
    const b = await setup(),
      c = await setup()
    await Promise.all([b.monitor.flush(), c.monitor.flush()])
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(payload(1).batchId).toBe(payload(0).batchId)
  })

  it('高频事件与新批次始终串行发送', async () => {
    let release!: (response: Response) => void
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const { monitor, ctx } = await setup({ batchSize: 1 })
    for (let i = 0; i < 12; i++) ctx.report(event(String(i)))
    const flushed = monitor.flush()
    await eventually(() => fetcher.mock.calls.length === 1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    release(new Response(null, { status: 202 }))
    await flushed
    expect(fetcher).toHaveBeenCalledTimes(12)
  })
})

describe('退出发送与容量', () => {
  it('Beacon 成功入队不触发成功回调，下一次 Fetch 确认仍使用同一 batchId', async () => {
    const beacon = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true)
    const success = vi.fn()
    const { monitor, ctx } = await setup({ reportSuccess: success })
    await monitor.flush()
    ctx.report(event())
    visible(false)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    expect(beacon).toHaveBeenCalledTimes(1)
    const beaconPayload = JSON.parse(await (beacon.mock.calls[0][1] as Blob).text())
    expect(success).not.toHaveBeenCalled()
    visible(true)
    vi.setSystemTime(Date.now() + 16000)
    await monitor.flush()
    expect(payload().batchId).toBe(beaconPayload.batchId)
    expect(success).toHaveBeenCalledTimes(1)
  })

  it('Beacon 抛错时使用小体积 keepalive，不等 IndexedDB 再发请求', async () => {
    vi.spyOn(navigator, 'sendBeacon').mockImplementation(() => {
      throw new Error('beacon failure')
    })
    const { monitor, ctx } = await setup()
    await monitor.flush()
    ctx.report(event())
    visible(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    })
  })

  it('超过退出字节预算的数据不调用 Beacon/keepalive，恢复可见后正常发送', async () => {
    const beacon = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true)
    const { monitor, ctx } = await setup()
    await monitor.flush()
    ctx.report(event('large', '中'.repeat(24000)))
    visible(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(beacon).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    visible(true)
    vi.setSystemTime(Date.now() + 16000)
    await monitor.flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1]!.keepalive).toBe(false)
  })

  it('按 UTF-8 字节分批，单个超限事件被明确丢弃', async () => {
    const drop = vi.fn()
    const { monitor, ctx } = await setup({ transport: { maxBatchBytes: 1800 }, reportDrop: drop })
    ctx.report(event('one', '中'.repeat(200)))
    ctx.report(event('two', '中'.repeat(200)))
    ctx.report(event('too-big', '中'.repeat(1000)))
    await monitor.flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const call of fetcher.mock.calls)
      expect(new TextEncoder().encode(call[1]!.body as string).byteLength).toBeLessThanOrEqual(1800)
    expect(drop).toHaveBeenCalledWith({ reason: 'event_too_large', eventId: 'too-big' })
  })

  it('内存与磁盘队列都有限额，溢出时拒绝新批次且上报丢弃原因', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('disabled')
    })
    fetcher.mockRejectedValue(new Error('offline'))
    const drop = vi.fn()
    const { monitor, ctx } = await setup({
      batchSize: 1,
      transport: { maxQueueTasks: 2 },
      reportDrop: drop,
    })
    for (let i = 0; i < 50; i++) ctx.report(event(String(i)))
    await monitor.flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(drop.mock.calls.filter(([info]) => info.reason === 'queue_full')).toHaveLength(48)
  })
})
