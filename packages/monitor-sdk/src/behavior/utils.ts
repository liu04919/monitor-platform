type HistoryMethod = 'pushState' | 'replaceState'
type HistoryMethodArgs = Parameters<History['pushState']>
let historyWrapped = false
let historyUseCount = 0
let originalPushState: History['pushState'] | null = null
let originalReplaceState: History['replaceState'] | null = null
let wrappedPushState: History['pushState'] | null = null
let wrappedReplaceState: History['replaceState'] | null = null

export type HistoryChangeDetail = {
  from: string
  to: string
  method: HistoryMethod
  args: HistoryMethodArgs
}

const wrapHistoryMethod = (
  method: HistoryMethod,
  originalMethod: History['pushState'] | History['replaceState'],
) => {
  return function (this: History, ...args: HistoryMethodArgs) {
    const from = window.location.href
    const result = originalMethod.apply(this, args)
    const to = window.location.href

    window.dispatchEvent(
      new CustomEvent<HistoryChangeDetail>(method, {
        detail: {
          from,
          to,
          method,
          args,
        },
      }),
    )

    return result
  } as History['pushState']
}

export const wrHistory = (): (() => void) => {
  historyUseCount++

  if (!historyWrapped) {
    originalPushState = history.pushState
    originalReplaceState = history.replaceState
    wrappedPushState = wrapHistoryMethod('pushState', originalPushState)
    wrappedReplaceState = wrapHistoryMethod('replaceState', originalReplaceState)

    history.pushState = wrappedPushState
    history.replaceState = wrappedReplaceState
    historyWrapped = true
  }

  let disposed = false

  return () => {
    if (disposed) {
      return
    }

    disposed = true
    historyUseCount = Math.max(historyUseCount - 1, 0)

    if (historyUseCount > 0 || !historyWrapped) {
      return
    }

    if (originalPushState && history.pushState === wrappedPushState) {
      history.pushState = originalPushState
    }

    if (originalReplaceState && history.replaceState === wrappedReplaceState) {
      history.replaceState = originalReplaceState
    }

    originalPushState = null
    originalReplaceState = null
    wrappedPushState = null
    wrappedReplaceState = null
    historyWrapped = false
  }
}
