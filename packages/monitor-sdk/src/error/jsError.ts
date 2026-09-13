import { getPathToElement } from '../common/utils'
import type {
  ExceptionErrorEvent,
  MonitorContext,
  MonitorPlugin,
  ResourceErrorEvent,
  ResourceErrorTarget,
} from '../types'
import { createErrorBase, normalizeException } from './shared'

function reportResourceError(ctx: MonitorContext, event: Event): void {
  const target = event.target as ResourceErrorTarget | null
  if (!target?.src && !target?.href) return

  const reportData: ResourceErrorEvent = {
    ...createErrorBase(ctx),
    eventType: 'resource_error',
    payload: {
      message: `${target.tagName || 'resource'} load error`,
      resource: {
        url: target.src || target.href || '',
        tagName: target.tagName,
        path: getPathToElement(target),
        html: target.outerHTML?.slice(0, 1000),
      },
      mechanism: { type: 'resource.error', handled: false },
    },
  }
  ctx.report(reportData)
}

function reportJsError(ctx: MonitorContext, event: ErrorEvent): void {
  const cors = event.message === 'Script error.'
  const exception = normalizeException(
    !cors && event.error instanceof Error ? event.error : event.message,
  )
  exception.message = event.message

  // 浏览器没有提供 Error.stack 时，保留 ErrorEvent 上已有的源码位置。
  if (!exception.stack.length && event.filename) {
    exception.stack.push({
      filename: event.filename,
      line: event.lineno || undefined,
      column: event.colno || undefined,
    })
  }

  const reportData: ExceptionErrorEvent = {
    ...createErrorBase(ctx),
    eventType: cors ? 'cors_error' : 'js_error',
    payload: {
      exception,
      mechanism: { type: 'window.onerror', handled: false },
    },
  }
  ctx.report(reportData)
}

function reportPromiseError(ctx: MonitorContext, event: PromiseRejectionEvent): void {
  const reportData: ExceptionErrorEvent = {
    ...createErrorBase(ctx),
    eventType: 'unhandled_rejection',
    payload: {
      exception: normalizeException(event.reason, 'UnhandledRejection'),
      mechanism: { type: 'unhandledrejection', handled: false },
    },
  }
  ctx.report(reportData)
}

/** 浏览器基础错误统一入口；框架内已接管的异常由 React/Vue 插件补充。 */
export const jsErrorPlugin = (): MonitorPlugin => ({
  name: 'error:js',
  setup(ctx) {
    // 资源错误不冒泡，使用捕获阶段；同一事件只进入一个分类。
    ctx.on(
      window,
      'error',
      (event) => {
        if (event instanceof ErrorEvent) reportJsError(ctx, event)
        else reportResourceError(ctx, event)
      },
      true,
    )
    ctx.on(
      window,
      'unhandledrejection',
      (event) => {
        reportPromiseError(ctx, event as PromiseRejectionEvent)
      },
      true,
    )
  },
})
