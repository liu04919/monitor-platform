import { createEventBase } from '../common/event'
import { getVueComponentInfo, parseStackFrames } from '../common/utils'
import type { ExceptionErrorEvent, MonitorContext, MonitorDispose } from '../types'

type VueErrorHandler = (err: unknown, vm: any, info: string) => void

export interface Vue {
  config: {
    errorHandler?: VueErrorHandler
  }
}

function stringifyUnknownError(err: unknown): string {
  if (typeof err === 'string') {
    return err
  }

  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function normalizeError(err: unknown): Error {
  if (err instanceof Error) {
    return err
  }

  return new Error(stringifyUnknownError(err))
}

function getComponentInfo(vm: any): {
  componentName: string
  src: string
} {
  const vue2Info = getVueComponentInfo(vm)

  if (vue2Info.componentName !== '<Anonymous>' || vue2Info.url) {
    return {
      componentName: vue2Info.componentName,
      src: vue2Info.url || '',
    }
  }

  const vue3Type = vm?.type || vm?.vnode?.type
  const name =
    vue3Type?.name || vue3Type?.__name || vue3Type?.displayName || vue3Type?.components?.name

  return {
    componentName: name ? `<${name}>` : vue2Info.componentName,
    src: vue3Type?.__file || vue2Info.url || '',
  }
}

function reportVueError(ctx: MonitorContext, err: unknown, vm: any, info: string): void {
  const error = normalizeError(err)
  const { componentName, src } = getComponentInfo(vm)

  const replayData = ctx.getRecordScreenData()

  const reportData: ExceptionErrorEvent = {
    ...createEventBase(ctx),

    category: 'error',
    eventType: 'vue_error',
    level: 'error',

    breadcrumbs: ctx.getBehaviorState(),
    replayData: replayData || undefined,

    payload: {
      exception: {
        name: error.name,
        message: error.message,
        stack: parseStackFrames(error),
      },

      mechanism: {
        type: 'vue.error_handler',
        handled: true,
      },

      component: {
        name: componentName,
        file: src || undefined,
        stack: info || undefined,
      },
    },
  }

  ctx.report(reportData)
}

export default function initVueError(ctx: MonitorContext, app: Vue): MonitorDispose | void {
  if (!app?.config) {
    return
  }

  const originalErrorHandler = app.config.errorHandler
  const errorHandler = (err: unknown, vm: any, info: string) => {
    reportVueError(ctx, err, vm, info)

    originalErrorHandler?.(err, vm, info)
  }

  app.config.errorHandler = errorHandler

  return () => {
    if (app.config.errorHandler === errorHandler) {
      app.config.errorHandler = originalErrorHandler
    }
  }
}
