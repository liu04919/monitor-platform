// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiStreamPlugin } from '../src/aiPerformance/stream'
import { createConfig } from '../src/common/config'
import type { AiStreamPluginOptions } from '../src/aiPerformance/types'
import type { AiEvent, MonitorContext, MonitorPlugin } from '../src/types'

// 使用原生 WHATWG Streams 和 Response，不用 DOM 模拟器的流实现。
let now = 0
let disposes: (() => void)[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('location', new URL('https://app.test/chat?token=secret#access_token=secret'))
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  now = 0
})

afterEach(() => {
  disposes.reverse().forEach((dispose) => dispose())
  disposes = []
  vi.useRealTimers()
})

function setup(options: AiStreamPluginOptions = {}, plugin?: MonitorPlugin) {
  const events: AiEvent[] = []
  const config = createConfig({ url: 'https://app.test/collect' })
  const ctx: MonitorContext = {
    config,
    getConfig: () => config,
    report: vi.fn((event) => {
      events.push(JSON.parse(JSON.stringify(event)) as AiEvent)
    }),
    getPlugin: () => undefined,
    events: { on: () => () => {}, off: () => {}, emit: () => {} },
    provide: () => {},
    consume: () => undefined,
    addBreadcrumb: () => {},
    getBreadcrumbs: () => [],
    getReplayData: () => '',
    addDispose: (dispose) => dispose,
    on: () => () => {},
  }
  const dispose = (plugin ?? aiStreamPlugin(options)).setup(ctx) ?? (() => {})
  disposes.push(dispose)
  return { ctx, dispose, events }
}

function source(status = 200) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const pull = vi.fn()
  const body = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value
      },
      cancel,
      pull,
    },
    { highWaterMark: 0 },
  )
  const response = new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
  const fetch = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetch)
  return { response, controller, cancel, pull, fetch }
}

const bytes = (value: string) => new TextEncoder().encode(value)
const attrs = (events: AiEvent[]) =>
  events.find((event) => event.eventType === 'stream_metric')!.payload.attributes!

async function wait(ms = 0) {
  now += ms
  await vi.advanceTimersByTimeAsync(ms)
}

describe('AI 流统计与背压', () => {
  it('零时刻首块有效、数据原样透传、仅最终汇总一次', async () => {
    const s = source()
    const { events } = setup()
    const response = await window.fetch('/api/chat')
    const reader = response.body!.getReader()
    s.controller.enqueue(bytes('你'))
    expect((await reader.read()).value).toEqual(bytes('你'))
    await wait(40)
    s.controller.enqueue(bytes('好'))
    expect((await reader.read()).value).toEqual(bytes('好'))
    await wait(60)
    s.controller.enqueue(bytes('!'))
    expect((await reader.read()).value).toEqual(bytes('!'))
    s.controller.close()
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expect(events).toHaveLength(1)
    expect(attrs(events)).toMatchObject({
      status: 200,
      success: true,
      endReason: 'end',
      requestStart: 0,
      responseStart: 0,
      firstChunkTime: 0,
      lastChunkTime: 100,
      ttfb: 0,
      ttft: 0,
      ttlt: 100,
      ttlb: 100,
      chunkCount: 3,
      totalBytes: 7,
      averageChunkInterval: 50,
      maxChunkInterval: 60,
    })
    for (const key of ['responseHeadersMs', 'firstChunkMs', 'lastChunkMs', 'durationMs'])
      expect(attrs(events)).not.toHaveProperty(key)
    expect(vi.getTimerCount()).toBe(0)
    expect(s.response.body!.locked).toBe(false)
  })

  it('四项耗时都从请求开始计算，尾块与读取结束分别计时', async () => {
    const s = source()
    let resolveResponse!: (response: Response) => void
    s.fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )
    const { events } = setup()
    const pendingResponse = window.fetch('/api/chat')
    await wait(200)
    resolveResponse(s.response)
    const reader = (await pendingResponse).body!.getReader()
    await wait(100)
    s.controller.enqueue(bytes('first'))
    await reader.read()
    await wait(500)
    s.controller.enqueue(bytes('last'))
    await reader.read()
    await wait(200)
    s.controller.close()
    await reader.read()
    expect(attrs(events)).toMatchObject({ ttfb: 200, ttft: 300, ttlt: 800, ttlb: 1000 })
    expect(events[0].payload.value).toBe(1000)
  })

  it('业务未读取时不提前拉取、统计或开启卡顿计时', async () => {
    const s = source()
    const { events } = setup()
    const response = await window.fetch('/api/chat')
    s.controller.enqueue(bytes('queued'))
    await wait(10_000)
    expect(s.pull).not.toHaveBeenCalled()
    expect(response.bodyUsed).toBe(false)
    expect(events).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await response.body!.cancel()
  })

  it('等待首块只报告一次，等待恢复后下一次 read 可再报一次', async () => {
    const s = source()
    const { events } = setup({ stallThreshold: 100 })
    const reader = (await window.fetch('/api/chat')).body!.getReader()
    const first = reader.read()
    await wait(99)
    expect(events).toEqual([])
    await wait(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: 'stream_stall',
      payload: { value: 100, attributes: { waitStart: 0, chunkCount: 0 } },
    })
    await wait(2000)
    expect(events).toHaveLength(1)
    s.controller.enqueue(bytes('first'))
    await first
    const second = reader.read()
    await wait(100)
    expect(events).toHaveLength(2)
    s.controller.enqueue(bytes('second'))
    await second
    s.controller.close()
    await reader.read()
    expect(events.map((event) => event.eventType)).toEqual([
      'stream_stall',
      'stream_stall',
      'stream_metric',
    ])
    expect(new Set(events.map((event) => event.payload.attributes!.traceId)).size).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('业务处理上一块的时间不算卡顿，下一次等待从 read 开始', async () => {
    const s = source()
    const { events } = setup({ stallThreshold: 100 })
    const reader = (await window.fetch('/api/chat')).body!.getReader()
    s.controller.enqueue(bytes('first'))
    await reader.read()
    await wait(10_000)
    expect(s.pull).not.toHaveBeenCalled()
    expect(events).toEqual([])
    const next = reader.read()
    await wait(50)
    expect(events).toEqual([])
    await wait(50)
    expect(events[0].payload.attributes!.waitStart).toBe(10_000)
    s.controller.enqueue(bytes('next'))
    await next
    await reader.cancel()
  })

  it.each([204, 200])('无正文 / 空正文 %i 不伪造首块、尾块或间隔', async (status) => {
    if (status === 204)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
    else source().controller.close()
    const { events } = setup()
    expect(await (await window.fetch('/api/chat')).text()).toBe('')
    expect(attrs(events)).toMatchObject({ status, success: true, chunkCount: 0, totalBytes: 0 })
    for (const key of [
      'firstChunkTime',
      'lastChunkTime',
      'ttft',
      'ttlt',
      'averageChunkInterval',
      'maxChunkInterval',
    ]) {
      expect(attrs(events)).not.toHaveProperty(key)
    }
  })

  it('HTTP 错误仍可读取正文，不误认为成功流', async () => {
    const s = source(500)
    s.controller.enqueue(bytes('server error'))
    s.controller.close()
    const { events } = setup()
    expect(await (await window.fetch('/api/chat')).text()).toBe('server error')
    expect(attrs(events)).toMatchObject({ status: 500, success: false, endReason: 'end' })
  })
})

describe('AI 流异常、取消与销毁', () => {
  it('Fetch 失败保留原始错误，不填不存在的响应头和首块耗时', async () => {
    const error = new Error('offline')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
    const { events } = setup()
    await expect(window.fetch('/api/chat')).rejects.toBe(error)
    expect(attrs(events)).toMatchObject({
      status: 0,
      success: false,
      endReason: 'error',
      errorMessage: 'offline',
    })
    expect(attrs(events)).not.toHaveProperty('ttfb')
    expect(attrs(events)).not.toHaveProperty('ttft')
  })

  it.each([false, true])(
    '原始流报错及时收尾，包括业务暂停且有缓存块：pending=%s',
    async (pending) => {
      const s = source()
      const { events } = setup()
      const reader = (await window.fetch('/api/chat')).body!.getReader()
      s.controller.enqueue(bytes('first'))
      await reader.read()
      let next: Promise<unknown> | undefined
      if (pending) next = reader.read().catch((error: unknown) => error)
      else s.controller.enqueue(bytes('buffered'))
      const error = new Error('upstream disconnected')
      s.controller.error(error)
      await wait()
      expect(events).toHaveLength(1)
      expect(attrs(events)).toMatchObject({
        endReason: 'error',
        errorMessage: error.message,
        chunkCount: 1,
      })
      if (next) expect(await next).toBe(error)
      await expect(reader.read()).rejects.toBe(error)
      expect(vi.getTimerCount()).toBe(0)
      expect(s.response.body!.locked).toBe(false)
    },
  )

  it.each([false, true])('取消保留 reason、结束一次、清理计时器：pending=%s', async (pending) => {
    const s = source()
    const { events } = setup()
    const reader = (await window.fetch('/api/chat')).body!.getReader()
    const next = pending ? reader.read() : undefined
    await wait()
    const reason = {
      toString() {
        throw new Error('bad reason')
      },
    }
    await reader.cancel(reason)
    if (next) expect(await next).toEqual({ done: true, value: undefined })
    expect(s.cancel).toHaveBeenCalledExactlyOnceWith(reason)
    expect(events).toHaveLength(1)
    expect(attrs(events)).toMatchObject({ endReason: 'cancel', success: false })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('原始 cancel 拒绝时仍返回同一个错误', async () => {
    const s = source()
    const error = new Error('cancel rejected')
    s.cancel.mockRejectedValue(error)
    const { events } = setup()
    await expect((await window.fetch('/api/chat')).body!.cancel('stop')).rejects.toBe(error)
    expect(events).toHaveLength(1)
    expect(attrs(events).endReason).toBe('cancel')
  })

  it('AbortSignal 自定义 reason 仍标记取消，init 覆盖 Request 信号', async () => {
    const original = new AbortController()
    const override = new AbortController()
    const s = source()
    const { events } = setup()
    const input = new Request('https://app.test/api/chat', { signal: original.signal })
    const response = await window.fetch(input, { signal: override.signal })
    const reason = new Error('user stop')
    override.abort(reason)
    // 受控 source 模拟原生 Fetch 在 abort 后使响应体报错。
    s.controller.error(reason)
    await wait()
    expect(attrs(events)).toMatchObject({ endReason: 'cancel', errorMessage: 'user stop' })
    await expect(response.text()).rejects.toBe(reason)
  })

  it('销毁停止 pending read 的监控，但不中止业务流', async () => {
    const s = source()
    const { events, dispose } = setup({ stallThreshold: 100 })
    const response = await window.fetch('/api/chat')
    const text = response.text()
    await wait()
    expect(vi.getTimerCount()).toBe(1)
    dispose()
    expect(vi.getTimerCount()).toBe(0)
    await wait(1000)
    s.controller.enqueue(bytes('still works'))
    s.controller.close()
    expect(await text).toBe('still works')
    expect(s.cancel).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('响应头返回前销毁，不再包装业务 Response', async () => {
    let resolve!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done
          }),
      ),
    )
    const { events, dispose } = setup()
    const pending = window.fetch('/api/chat')
    dispose()
    const response = new Response('late')
    resolve(response)
    expect(await pending).toBe(response)
    expect(events).toEqual([])
  })

  it('多个实例乱序销毁，已销毁包装不复活，最后恢复 Fetch', async () => {
    const s = source()
    const a = setup(),
      b = setup()
    a.dispose()
    const response = await window.fetch('/api/chat')
    s.controller.close()
    await response.text()
    expect(a.events).toEqual([])
    expect(b.events).toHaveLength(1)
    b.dispose()
    expect(window.fetch).toBe(s.fetch)
  })

  it('不覆盖外部包装，遗留已销毁层只透传', async () => {
    const s = source()
    const { events, dispose } = setup()
    const previous = window.fetch
    const external: typeof fetch = (...args) => previous.apply(window, args)
    window.fetch = external
    dispose()
    expect(window.fetch).toBe(external)
    expect(await window.fetch('/api/chat')).toBe(s.response)
    expect(events).toEqual([])
    s.controller.close()
  })
})

describe('AI 流采集隔离与配置', () => {
  it('异步 getMeta 的拒绝被隔离，不作为同步结果使用', async () => {
    const fetch = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetch)
    const fail = async () => {
      throw new Error('async callback failed')
    }
    // 模拟 JavaScript 调用者绕过 TypeScript 的同步回调约束。
    const { events } = setup({ getMeta: fail as unknown as AiStreamPluginOptions['getMeta'] })
    expect(await (await window.fetch('/api/chat')).text()).toBe('ok')
    await wait()
    expect(events).toHaveLength(1)
    expect(attrs(events)).not.toHaveProperty('meta')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('getMeta 中销毁实例也不继续采集或阻断请求', async () => {
    const s = source()
    const current = setup({
      getMeta: () => {
        current.dispose()
        return { model: 'test' }
      },
    })
    expect(await window.fetch('/api/chat')).toBe(s.response)
    expect(current.events).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    s.controller.close()
  })

  it('init.signal = null 不错误继承 Request 的已中止信号', async () => {
    const controller = new AbortController()
    controller.abort()
    const s = source()
    const { events } = setup()
    const response = await window.fetch(
      new Request('https://app.test/api/chat', { signal: controller.signal }),
      { signal: null },
    )
    s.controller.error(new Error('actual network failure'))
    await expect(response.text()).rejects.toThrow('actual network failure')
    expect(attrs(events).endReason).toBe('error')
  })

  it.each([204, 205, 304])('浏览器无正文状态 %i 即使暴露空流也不重建 Response', async (status) => {
    const s = source()
    Object.defineProperty(s.response, 'status', { value: status })
    s.controller.close()
    const { events } = setup()
    expect(await window.fetch('/api/chat')).toBe(s.response)
    expect(attrs(events)).toMatchObject({ status, chunkCount: 0, endReason: 'end' })
  })

  it('状态不可见的 Response 原样返回，不编造成功/失败事件', async () => {
    const response = Response.error()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const { events } = setup()
    expect(await window.fetch('/api/chat')).toBe(response)
    expect(events).toEqual([])
  })

  it('已使用和已锁定的 Response 不再次消费', async () => {
    const s = source()
    const { events } = setup()
    const reader = s.response.body!.getReader()
    expect(await window.fetch('/api/chat')).toBe(s.response)
    await reader.cancel()
    reader.releaseLock()
    expect(await window.fetch('/api/chat')).toBe(s.response)
    expect(events).toEqual([])
  })

  it('JSON 解析错误和重复读取错误不被监控改写', async () => {
    const s = source()
    s.controller.enqueue(bytes('not json'))
    s.controller.close()
    const { events } = setup()
    const response = await window.fetch('/api/chat')
    await expect(response.json()).rejects.toBeInstanceOf(SyntaxError)
    await expect(response.text()).rejects.toBeInstanceOf(TypeError)
    expect(attrs(events)).toMatchObject({ success: true, endReason: 'end' })
  })

  it('正常持有 body 锁时原生消费方法仍拒绝，不提前拉取', async () => {
    const s = source()
    setup()
    const response = await window.fetch('/api/chat')
    const reader = response.body!.getReader()
    await expect(response.text()).rejects.toBeInstanceOf(TypeError)
    expect(s.pull).not.toHaveBeenCalled()
    await reader.cancel()
  })
  it.each(['getMeta', 'getConfig', 'report'])('%s 抛错不改变业务数据或重复请求', async (hook) => {
    const s = source()
    s.controller.enqueue(bytes('business'))
    s.controller.close()
    const fail = () => {
      throw new Error('monitor failed')
    }
    const { ctx } = setup({
      getMeta: hook === 'getMeta' ? fail : undefined,
    })
    if (hook === 'getConfig') ctx.getConfig = fail
    if (hook === 'report') ctx.report = fail
    const init = { method: 'POST', body: 'do not collect' }
    expect(await (await window.fetch('/api/chat', init)).text()).toBe('business')
    expect(s.fetch).toHaveBeenCalledExactlyOnceWith('/api/chat', init)
    expect(s.fetch.mock.contexts[0]).toBe(window)
  })

  it('异步 report 拒绝也不会污染业务流', async () => {
    const s = source()
    s.controller.close()
    const { ctx } = setup()
    ctx.report = vi.fn().mockRejectedValue(new Error('async report failed'))
    expect(await (await window.fetch('/api/chat')).text()).toBe('')
    await wait()
  })

  it('仅匹配目标请求，带查询参数的自身上报也排除', async () => {
    const s = source()
    const { events } = setup({ urlPatterns: ['/collect'] })
    expect(await window.fetch('/collect?retry=1')).toBe(s.response)
    expect(events).toEqual([])
    expect(s.response.body!.locked).toBe(false)
    s.controller.close()
  })

  it.each([
    'https://app.test/api/messages/stream?conversation=1',
    new URL('https://app.test/api/messages/stream?conversation=1'),
    new Request('https://app.test/api/messages/stream?conversation=1'),
  ])('字符串数组中任意一项包含匹配，支持 Fetch 输入 %s', async (input) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok')),
    )
    const { events } = setup({ urlPatterns: ['/api/chat', '/api/messages'] })
    for (let i = 0; i < 4; i++) await (await window.fetch(input)).text()
    expect(events).toHaveLength(4)
  })

  it.each(['/api/users', '/API/CHAT'])('非目标 URL %s 返回原始响应，不采集', async (url) => {
    const s = source()
    const { events } = setup({ urlPatterns: ['/api/chat'] })
    expect(await window.fetch(url)).toBe(s.response)
    expect(events).toEqual([])
    expect(s.response.body!.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    s.controller.close()
  })

  it('配置数组复制，空数组关闭，非目标返回原始 Response', async () => {
    const s = source()
    const patterns: string[] = []
    const plugin = aiStreamPlugin({ urlPatterns: patterns })
    patterns.push('/api/chat')
    const { events } = setup({}, plugin)
    expect(await window.fetch('/api/chat')).toBe(s.response)
    expect(events).toEqual([])
    s.controller.close()
  })

  it.each([0, -1, NaN, Infinity, 2_147_483_648])('拒绝非法门槛 %s', (stallThreshold) => {
    expect(() => aiStreamPlugin({ stallThreshold })).toThrow(/stallThreshold/)
  })

  it('URL 脱敏、meta 复制且不保留凭据、正文或后续修改', async () => {
    const s = source()
    const meta = { model: 'demo', token: 'secret', nested: { count: 1 } }
    const { events } = setup({ getMeta: () => meta })
    const response = await window.fetch('https://user:password@app.test/api/chat?token=secret')
    meta.nested.count = 999
    s.controller.enqueue(bytes('private answer'))
    s.controller.close()
    await response.text()
    expect(attrs(events).meta).toEqual({ model: 'demo', nested: { count: 1 } })
    expect(events[0].pageUrl).toBe('https://app.test/chat')
    expect(attrs(events).url).toBe('https://app.test/api/chat')
    expect(JSON.stringify(events)).not.toMatch(/secret|password|private answer/)
  })

  it('包装准备失败时不锁定或读取原始流', async () => {
    const s = source()
    const { events } = setup()
    vi.spyOn(Object, 'defineProperties').mockImplementationOnce(() => {
      throw new Error('cannot define')
    })
    expect(await window.fetch('/api/chat')).toBe(s.response)
    expect(s.response.body!.locked).toBe(false)
    expect(s.response.bodyUsed).toBe(false)
    expect(events).toEqual([])
    s.controller.close()
  })

  it('保留响应元信息，clone 仍可读取且不会重复统计', async () => {
    const s = source()
    Object.defineProperties(s.response, {
      url: { value: 'https://app.test/redirected' },
      type: { value: 'cors' },
      redirected: { value: true },
    })
    const { events } = setup()
    const response = await window.fetch('/api/chat')
    const clone = response.clone(),
      nextClone = clone.clone()
    for (const value of [response, clone, nextClone]) {
      expect(value).toBeInstanceOf(Response)
      expect(value.url).toBe('https://app.test/redirected')
      expect(value.type).toBe('cors')
      expect(value.redirected).toBe(true)
      expect(value.headers.get('Content-Type')).toBe('text/plain')
    }
    s.controller.enqueue(bytes('content'))
    s.controller.close()
    expect(await Promise.all([response.text(), clone.text(), nextClone.text()])).toEqual([
      'content',
      'content',
      'content',
    ])
    expect(events).toHaveLength(1)
  })
})
