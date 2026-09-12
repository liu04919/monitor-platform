import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installHistoryEvents } from '../src/behavior/history'

let originalPush: History['pushState']
let originalReplace: History['replaceState']
let cleanups: (() => void)[] = []

beforeEach(() => {
  originalPush = history.pushState
  originalReplace = history.replaceState
  history.replaceState(null, '', '/start')
})

afterEach(() => {
  cleanups.reverse().forEach((cleanup) => cleanup())
  cleanups = []
  history.pushState = originalPush
  history.replaceState = originalReplace
})

function install() {
  const dispose = installHistoryEvents()
  cleanups.push(dispose)
  return dispose
}

function listen(type: string) {
  const listener = vi.fn((event: Event) => ({ type: event.type, url: location.href }))
  window.addEventListener(type, listener)
  cleanups.push(() => window.removeEventListener(type, listener))
  return listener
}

describe('History 自定义事件', () => {
  it.each([
    ['pushState', 'pushstate'],
    ['replaceState', 'replacestate'],
  ] as const)('%s 成功后同步派发 %s，不附带调用参数或冒充 popstate', (method, eventType) => {
    const listener = listen(eventType)
    const popstate = listen('popstate')
    install()
    const result = history[method]({ token: 'secret' }, '', '/next')
    expect(result).toBeUndefined()
    expect(history.state).toEqual({ token: 'secret' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.results[0].value).toEqual({
      type: eventType,
      url: `${location.origin}/next`,
    })
    expect(listener.mock.calls[0][0]).not.toHaveProperty('detail')
    expect(popstate).not.toHaveBeenCalled()
  })

  it.each([
    ['pushState', 'pushstate'],
    ['replaceState', 'replacestate'],
  ] as const)('%s 保留 this 和参数，原方法抛错时不派发 %s', (method, eventType) => {
    const error = new Error('history failed')
    const original = vi.spyOn(history, method).mockImplementation(() => {
      throw error
    })
    const listener = listen(eventType)
    install()
    const state = { value: 1 }
    const receiver = {} as History
    expect(() => history[method].call(receiver, state, '', '/failed')).toThrow(error)
    expect(original).toHaveBeenCalledWith(state, '', '/failed')
    expect(original.mock.contexts[0]).toBe(receiver)
    expect(listener).not.toHaveBeenCalled()
  })

  it('多个使用方只派发一次，重复释放无效，最后释放才恢复两个方法', () => {
    const listener = listen('pushstate')
    const disposeA = install()
    const wrapped = history.pushState
    const disposeB = install()
    expect(history.pushState).toBe(wrapped)
    history.pushState(null, '', '/both')
    expect(listener).toHaveBeenCalledTimes(1)
    disposeA()
    disposeA()
    history.pushState(null, '', '/only-b')
    expect(listener).toHaveBeenCalledTimes(2)
    disposeB()
    expect(history.pushState).toBe(originalPush)
    expect(history.replaceState).toBe(originalReplace)
    history.pushState(null, '', '/disposed')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('不覆盖后来安装的外部包装，停用的旧层在重新安装后也不重复派发', () => {
    const listener = listen('pushstate')
    const dispose = install()
    const wrapped = history.pushState
    const external = vi.fn(function (this: History, ...args: Parameters<History['pushState']>) {
      return wrapped.apply(this, args)
    })
    history.pushState = external
    dispose()
    expect(history.pushState).toBe(external)
    history.pushState(null, '', '/outside')
    expect(listener).not.toHaveBeenCalled()
    const disposeAgain = install()
    history.pushState(null, '', '/reinstalled')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(external).toHaveBeenCalledTimes(2)
    disposeAgain()
    expect(history.pushState).toBe(external)
  })

  it('事件派发自身失败不会改变原本成功的 History 调用', () => {
    install()
    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {
      throw new Error('dispatch failed')
    })
    expect(() => history.pushState({ value: 1 }, '', '/success')).not.toThrow()
    expect(location.pathname).toBe('/success')
    expect(history.state).toEqual({ value: 1 })
  })
})
