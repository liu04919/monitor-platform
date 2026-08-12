import { getPathToElement, parseStackFrames } from '../common/utils'
import {
  ResourceErrorTarget,
  ExceptionErrorEvent,
  MonitorContext,
  ResourceErrorEvent,
  StackFrame,
} from '../types'
import { createEventBase } from '../common/event'

type ErrorListenerOptions = {
  js?: boolean
  promise?: boolean
  resource?: boolean
  cors?: boolean
}

type ErrorListenerState = {
  options: Required<ErrorListenerOptions>
  hasErrorListener: boolean
  hasPromiseListener: boolean
}

const LISTENER_STATE = 'error:browser-listener-state'

function getDiagnosticFields(ctx: MonitorContext) {
  const replayData = ctx.getRecordScreenData()

  return {
    breadcrumbs: ctx.getBehaviorState(),
    replayData: replayData || undefined,
  }
}

function normalizeOptions(options: ErrorListenerOptions): Required<ErrorListenerOptions> {
  return {
    js: !!options.js,
    promise: !!options.promise,
    resource: !!options.resource,
    cors: !!options.cors,
  }
}

function getListenerState(ctx: MonitorContext): ErrorListenerState {
  const state = ctx.consume<ErrorListenerState>(LISTENER_STATE)

  if (state) {
    return state
  }

  const nextState: ErrorListenerState = {
    options: {
      js: false,
      promise: false,
      resource: false,
      cors: false,
    },
    hasErrorListener: false,
    hasPromiseListener: false,
  }

  ctx.provide(LISTENER_STATE, nextState)

  return nextState
}

function isErrorEvent(event: Event): event is ErrorEvent {
  return event instanceof ErrorEvent
}

function isCorsError(event: ErrorEvent): boolean {
  return event.message === 'Script error.'
}

function getResourceTarget(event: Event): ResourceErrorTarget | null {
  const target = event.target as ResourceErrorTarget | null

  if (!target) {
    return null
  }

  if (!target.src && !target.href) {
    return null
  }

  return target
}

function initResourceError(ctx: MonitorContext, event: Event): void {
  const target = getResourceTarget(event)

  if (!target) {
    return
  }

  const url = target.src || target.href || ''
  const tagName = target.tagName
  const message = `${tagName || 'resource'} load error`

  const reportData: ResourceErrorEvent = {
    ...createEventBase(ctx),
    ...getDiagnosticFields(ctx),

    category: 'error',
    eventType: 'resource_error',
    level: 'error',

    payload: {
      message,

      resource: {
        url,
        tagName,
        path: getPathToElement(target),
        html: target.outerHTML?.slice(0, 1000),
      },

      mechanism: {
        type: 'resource.error',
        handled: false,
      },
    },
  }

  ctx.report(reportData)
}

function initJsError(ctx: MonitorContext, event: ErrorEvent): void {
  const { colno, lineno, message, filename, error } = event

  let stack: StackFrame[] = []

  if (error instanceof Error) {
    stack = parseStackFrames(error)
  }

  /**
   * 有些浏览器只提供 filename、lineno、colno，
   * 没有 Error.stack。
   */
  if (!stack.length && filename) {
    stack.push({
      filename,
      line: lineno || undefined,
      column: colno || undefined,
    })
  }

  const reportData: ExceptionErrorEvent = {
    ...createEventBase(ctx),
    ...getDiagnosticFields(ctx),

    category: 'error',
    eventType: 'js_error',
    level: 'error',

    payload: {
      exception: {
        name: error instanceof Error ? error.name : 'Error',
        message,
        stack,
      },

      mechanism: {
        type: 'window.onerror',
        handled: false,
      },
    },
  }

  ctx.report(reportData)
}

function initCorsError(ctx: MonitorContext, event: ErrorEvent): void {
  const stack: StackFrame[] = []

  if (event.filename) {
    stack.push({
      filename: event.filename,
      line: event.lineno || undefined,
      column: event.colno || undefined,
    })
  }

  const reportData: ExceptionErrorEvent = {
    ...createEventBase(ctx),
    ...getDiagnosticFields(ctx),

    category: 'error',
    eventType: 'cors_error',
    level: 'error',

    payload: {
      exception: {
        name: 'Error',
        message: event.message || 'Script error.',
        stack,
      },

      mechanism: {
        type: 'window.onerror',
        handled: false,
      },
    },
  }

  ctx.report(reportData)
}

function normalizePromiseReason(reason: unknown): {
  name: string
  message: string
  stack: StackFrame[]
} {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message,
      stack: parseStackFrames(reason),
    }
  }

  if (typeof reason === 'string') {
    return {
      name: 'UnhandledRejection',
      message: reason,
      stack: [],
    }
  }

  try {
    return {
      name: 'UnhandledRejection',
      message: JSON.stringify(reason),
      stack: [],
    }
  } catch {
    return {
      name: 'UnhandledRejection',
      message: String(reason),
      stack: [],
    }
  }
}

function initPromiseError(ctx: MonitorContext, event: PromiseRejectionEvent): void {
  const exception = normalizePromiseReason(event.reason)

  const reportData: ExceptionErrorEvent = {
    ...createEventBase(ctx),
    ...getDiagnosticFields(ctx),

    category: 'error',
    eventType: 'unhandled_rejection',
    level: 'error',

    payload: {
      exception,

      mechanism: {
        type: 'unhandledrejection',
        handled: false,
      },
    },
  }

  ctx.report(reportData)
}

export default function initErrorEventListener(
  ctx: MonitorContext,
  options: ErrorListenerOptions = {
    js: true,
    promise: true,
    resource: true,
    cors: true,
  },
): void {
  const state = getListenerState(ctx)
  const normalizedOptions = normalizeOptions(options)

  state.options.js ||= normalizedOptions.js
  state.options.promise ||= normalizedOptions.promise
  state.options.resource ||= normalizedOptions.resource
  state.options.cors ||= normalizedOptions.cors

  if (
    (state.options.js || state.options.resource || state.options.cors) &&
    !state.hasErrorListener
  ) {
    state.hasErrorListener = true

    ctx.on(
      window,
      'error',
      (event: ErrorEvent | Event) => {
        if (!isErrorEvent(event)) {
          if (state.options.resource) {
            initResourceError(ctx, event)
          }
          return
        }

        if (isCorsError(event)) {
          if (state.options.cors) {
            initCorsError(ctx, event)
          }
          return
        }

        if (state.options.js) {
          initJsError(ctx, event)
        }
      },
      true,
    )
  }

  if (state.options.promise && !state.hasPromiseListener) {
    state.hasPromiseListener = true

    ctx.on(
      window,
      'unhandledrejection',
      (event) => {
        initPromiseError(ctx, event as PromiseRejectionEvent)
      },
      true,
    )
  }
}
