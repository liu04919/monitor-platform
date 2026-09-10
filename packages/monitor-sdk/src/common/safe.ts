/** 监控回调不允许进入业务调用链，也不递归使用 console 上报自身异常。 */
export function safely(callback: () => unknown): void {
  try {
    const result = callback()
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => {})
    }
  } catch {
    // 监控故障与业务隔离。
  }
}
