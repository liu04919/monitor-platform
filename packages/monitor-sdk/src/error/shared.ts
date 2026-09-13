import { createEventBase } from '../common/event'
import { parseStackFrames } from '../common/utils'
import type { ExceptionInfo, MonitorContext } from '../types'

/** 在错误发生时读取诊断快照，三个插件使用相同的事件基础字段。 */
export function createErrorBase(ctx: MonitorContext) {
  return {
    ...createEventBase(ctx),
    category: 'error' as const,
    level: 'error' as const,
    breadcrumbs: ctx.getBreadcrumbs(),
    replayData: ctx.getReplayData() || undefined,
  }
}

function errorMessage(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    // 循环引用、BigInt 等不能直接序列化，仍保留可读的拒绝原因。
  }
  try {
    return String(value)
  } catch {
    return 'Unknown error'
  }
}

export function normalizeException(value: unknown, name = 'Error'): ExceptionInfo {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: parseStackFrames(value) }
  }
  // 非 Error 值没有原始调用栈，不能用 SDK 内部 new Error() 的位置冒充。
  return { name, message: errorMessage(value), stack: [] }
}
