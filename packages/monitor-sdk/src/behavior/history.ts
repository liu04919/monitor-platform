import { safely } from '../common/safe'

let users = 0
let restore: (() => void) | undefined

function wrapHistoryMethod(
  method: 'pushState' | 'replaceState',
  eventType: 'pushstate' | 'replacestate',
): () => void {
  const original = history[method]
  let active = true
  const wrapped: History['pushState'] = function (this: History, ...args) {
    const result = original.apply(this, args)
    // 原方法成功后才派发自定义事件，不携带可能包含敏感数据的 state 或参数。
    if (active) safely(() => window.dispatchEvent(new Event(eventType)))
    return result
  }
  history[method] = wrapped
  return () => {
    active = false
    // 外部库后来又包装了入口时，不覆盖外部包装；遗留的本层已停止派发。
    if (history[method] === wrapped) history[method] = original
  }
}

// 多个 Monitor 共享一层包装；事件监听、URL 和计时仍由各实例自己管理。
export function installHistoryEvents(): () => void {
  if (users === 0) {
    const restorePushState = wrapHistoryMethod('pushState', 'pushstate')
    const restoreReplaceState = wrapHistoryMethod('replaceState', 'replacestate')
    restore = () => {
      restorePushState()
      restoreReplaceState()
    }
  }
  users += 1
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    users -= 1
    if (users === 0) {
      restore?.()
      restore = undefined
    }
  }
}
