import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crashPlugin, stabilityPlugins } from '../src/stability'
import { HeartbeatWatchdog } from '../src/stability/heartbeat/watchdog'
import {
  heartbeatOptions,
  type MainMessage,
  type WorkerMessage,
} from '../src/stability/heartbeat/types'
import { createConfig } from '../src/common/config'
import type { MonitorContext } from '../src/types'
import { visible } from './helpers'

const options = heartbeatOptions({})
let cleanups: (() => void)[]

beforeEach(() => {
  vi.useFakeTimers()
  cleanups = []
  visible(true)
})

afterEach(() => {
  cleanups.reverse().forEach((cleanup) => cleanup())
  vi.useRealTimers()
})

function watchdog() {
  const ping = vi.fn<(id: number) => void>()
  const report = vi.fn()
  const dog = new HeartbeatWatchdog(options, ping, report)
  cleanups.push(() => dog.stop())
  dog.setActive(true)
  const reply = () => dog.pong(ping.mock.lastCall![0])
  return { dog, ping, report, reply }
}

describe('主线程心跳计时', () => {
  it('默认 5 秒心跳、15 秒超时；快照独立为 10 秒', () => {
    expect(options).toEqual({ intervalMs: 5000, timeoutMs: 15000, snapshotIntervalMs: 10000 })
    const { report } = watchdog()
    vi.advanceTimersByTime(14999)
    expect(report).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(report).toHaveBeenCalledExactlyOnceWith(15000)
  })

  it('正常回复时持续运行，不报告无响应', () => {
    const { ping, report, reply } = watchdog()
    reply()
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(5000)
      reply()
    }
    expect(ping).toHaveBeenCalledTimes(21)
    expect(report).not.toHaveBeenCalled()
  })

  it('同一次无响应只报一次，恢复后还能报告下一次', () => {
    const { ping, report, reply } = watchdog()
    vi.advanceTimersByTime(60000)
    expect(report).toHaveBeenCalledTimes(1)
    expect(ping.mock.calls.length).toBeGreaterThan(10)
    reply()
    vi.advanceTimersByTime(15000)
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('过期的 pong 不能复活当前心跳；隐藏时暂停，恢复时重新计时', () => {
    const { dog, ping, report, reply } = watchdog()
    const stale = ping.mock.lastCall![0]
    vi.advanceTimersByTime(10000)
    dog.pong(stale)
    vi.advanceTimersByTime(5000)
    expect(report).toHaveBeenCalledTimes(1)
    dog.setActive(false)
    const count = ping.mock.calls.length
    vi.advanceTimersByTime(60000)
    expect(ping).toHaveBeenCalledTimes(count)
    dog.setActive(true)
    dog.pong(stale)
    vi.advanceTimersByTime(10000)
    expect(report).toHaveBeenCalledTimes(1)
    reply()
    vi.advanceTimersByTime(15000)
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('重复的可见事件不会不停推迟超时', () => {
    const { dog, report } = watchdog()
    vi.advanceTimersByTime(10000)
    dog.setActive(true)
    vi.advanceTimersByTime(5000)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('Worker 自己经历长暂停后先重新探测，不把休眠时间当成主线程卡死', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { report, reply } = watchdog()
    reply()
    now = 60000
    vi.advanceTimersByTime(5000)
    expect(report).not.toHaveBeenCalled()
    reply()
    for (let i = 0; i < 3; i++) {
      now += 5000
      vi.advanceTimersByTime(5000)
    }
    expect(report).toHaveBeenCalledExactlyOnceWith(15000)
  })

  it('停止后没有残留定时器，旧回复不能重新启动', () => {
    const { dog, ping, report, reply } = watchdog()
    dog.stop()
    reply()
    vi.advanceTimersByTime(60000)
    expect(ping).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([0, -1, NaN, Infinity, 2 ** 31])('拒绝非法定时参数 %s', (value) => {
    for (const key of ['intervalMs', 'timeoutMs', 'snapshotIntervalMs']) {
      expect(() => crashPlugin({ [key]: value })).toThrow()
    }
  })

  it('超时必须大于心跳间隔，组合插件也校验 heartbeat 配置', () => {
    expect(() => crashPlugin({ intervalMs: 5000, timeoutMs: 5000 })).toThrow()
    expect(() => stabilityPlugins({ heartbeat: { timeoutMs: 1 } })).toThrow()
  })
})

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage?: (event: MessageEvent<WorkerMessage>) => void
  onerror?: (event: ErrorEvent) => void
  postMessage = vi.fn<(message: MainMessage) => void>()
  terminate = vi.fn()
  constructor() {
    FakeWorker.instances.push(this)
  }
  ping(id: number) {
    this.onmessage?.({ data: { type: 'ping', id } } as MessageEvent<WorkerMessage>)
  }
}

function pluginSetup(input = {}) {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:heartbeat-test')
      static revokeObjectURL = vi.fn()
    },
  )
  const replay = vi.fn(() => 'recording')
  const config = createConfig({ ...input })
  const ctx = {
    getConfig: () => config,
    getReplayData: replay,
    getBreadcrumbs: () => [{ category: 'custom', timestamp: 1, message: 'recent action' }],
    on(target: EventTarget, name: string, listener: EventListener) {
      target.addEventListener(name, listener)
      const remove = () => target.removeEventListener(name, listener)
      cleanups.push(remove)
      return remove
    },
  } as unknown as MonitorContext
  const dispose = crashPlugin().setup(ctx) as () => void
  cleanups.push(dispose)
  return { worker: FakeWorker.instances[0], replay, dispose, ctx }
}

describe('主线程 Worker 生命周期和快照', () => {
  it('pong 立即发送且不生成录屏；快照单独按频率更新', () => {
    const { worker, replay } = pluginSetup()
    worker.ping(1)
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'pong', id: 1 })
    expect(replay).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(replay).toHaveBeenCalledTimes(1)
    for (let i = 2; i <= 5; i++) worker.ping(i)
    expect(replay).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10000)
    expect(replay).toHaveBeenCalledTimes(2)
  })

  it('配置不跨线程传递回调或插件，投递目标完整保留', () => {
    const { worker } = pluginSetup({ appId: 'a', publicKey: 'pk', reportSuccess: () => {} })
    const init = worker.postMessage.mock.calls[0][0]
    expect(init).toMatchObject({ type: 'init', config: { appId: 'a', publicKey: 'pk' } })
    expect(() => structuredClone(init)).not.toThrow()
    expect(init).not.toHaveProperty('config.reportSuccess')
    expect(init).toHaveProperty('callbacks', ['reportSuccess'])
  })

  it('Worker 发送结果交回配置的回调，回调异常不影响下一次心跳', () => {
    const success = vi.fn(() => {
      throw new Error('business callback failed')
    })
    const { worker } = pluginSetup({ reportSuccess: success })
    expect(() =>
      worker.onmessage?.(
        new MessageEvent<WorkerMessage>('message', {
          data: { type: 'callback', name: 'reportSuccess', events: [] },
        }),
      ),
    ).not.toThrow()
    expect(success).toHaveBeenCalledExactlyOnceWith([])
    worker.ping(1)
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'pong', id: 1 })
  })

  it('旧 Worker 的迟到消息和错误不能操作新 Worker', () => {
    const { worker: oldWorker } = pluginSetup()
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    const newWorker = FakeWorker.instances[1]
    const count = newWorker.postMessage.mock.calls.length
    oldWorker.ping(99)
    oldWorker.onerror?.(new ErrorEvent('error'))
    expect(newWorker.postMessage).toHaveBeenCalledTimes(count)
    expect(newWorker.terminate).not.toHaveBeenCalled()
  })

  it('录屏超过预算时省略完整附件，但保留页面与面包屑', () => {
    const { worker, replay } = pluginSetup({ transport: { maxBatchBytes: 4096 } })
    replay.mockReturnValue('x'.repeat(5000))
    vi.advanceTimersByTime(0)
    expect(worker.postMessage.mock.lastCall![0]).toMatchObject({
      type: 'snapshot',
      snapshot: { replayData: '', breadcrumbs: [{ message: 'recent action' }] },
    })
  })

  it('录屏生成失败也能发送轻量快照并回复心跳', () => {
    const { worker, replay } = pluginSetup()
    replay.mockImplementation(() => {
      throw new Error('replay failed')
    })
    vi.advanceTimersByTime(0)
    expect(worker.postMessage.mock.lastCall![0]).toMatchObject({
      type: 'snapshot',
      snapshot: { replayData: '' },
    })
    worker.ping(1)
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'pong', id: 1 })
  })

  it('后台停止快照和心跳，回到前台恢复；不创建重复 Worker', () => {
    const { worker, replay } = pluginSetup()
    visible(false)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(20000)
    worker.ping(10)
    expect(replay).not.toHaveBeenCalled()
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'active', active: false })
    visible(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(0)
    expect(replay).toHaveBeenCalledTimes(1)
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('模拟 BFCache pagehide/pageshow 后重建 Worker，重复 pageshow 不重复创建', () => {
    const { worker, dispose } = pluginSetup()
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWorker.instances).toHaveLength(1)
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(FakeWorker.instances).toHaveLength(2)
    dispose()
    window.dispatchEvent(new Event('pageshow'))
    expect(FakeWorker.instances).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('freeze/resume 暂停并恢复，销毁一个实例不终止其他实例', () => {
    const a = pluginSetup()
    const b = pluginSetup()
    a.dispose()
    expect(b.worker.terminate).not.toHaveBeenCalled()
    document.dispatchEvent(new Event('freeze'))
    expect(b.worker.terminate).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('resume'))
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('Worker 启动受限时不让 SDK 初始化失败，并释放 Blob URL', () => {
    const { ctx, dispose } = pluginSetup()
    dispose()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('CSP blocked')
        }
      },
    )
    const cleanup = crashPlugin().setup(ctx) as () => void
    cleanups.push(cleanup)
    expect(console.warn).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
