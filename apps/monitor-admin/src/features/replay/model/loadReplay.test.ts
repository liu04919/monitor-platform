import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadReplay } from './loadReplay'

class TestWorker {
  static current: TestWorker
  onmessage?: (event: { data: unknown }) => void
  onerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    TestWorker.current = this
  }
}

describe('loadReplay worker lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', TestWorker)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it('成功后释放 worker 和计时器', async () => {
    const promise = loadReplay('recording', new AbortController().signal)
    const clip = { events: [], startTime: 0, endTime: 1, width: 100, height: 100 }
    TestWorker.current.onmessage?.({ data: { clip } })
    expect(await promise).toEqual(clip)
    expect(TestWorker.current.postMessage).toHaveBeenCalledWith('recording')
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('离开页签时停止解压', async () => {
    const controller = new AbortController()
    const promise = loadReplay('recording', controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('超时后释放资源并提示重试', async () => {
    const promise = loadReplay('recording', new AbortController().signal)
    const assertion = expect(promise).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce()
  })
  it('保留解码错误并清理 worker', async () => {
    const promise = loadReplay('recording', new AbortController().signal)
    TestWorker.current.onmessage?.({ data: { error: '录屏损坏' } })
    await expect(promise).rejects.toThrow('录屏损坏')
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce()
  })
})
