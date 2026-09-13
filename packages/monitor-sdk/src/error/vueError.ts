import { getVueComponentInfo } from '../common/utils'
import type { ExceptionErrorEvent, MonitorContext, MonitorPlugin } from '../types'
import { createErrorBase, normalizeException } from './shared'

type VueErrorHandler = (err: unknown, vm: any, info: string) => void

export interface Vue {
  config: {
    errorHandler?: VueErrorHandler
  }
}

function getComponentInfo(vm: any): {
  componentName: string
  src: string
} {
  const vue2Info = vm?.$options
    ? getVueComponentInfo(vm)
    : { componentName: '<Anonymous>', url: '' }

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
  const { componentName, src } = getComponentInfo(vm)
  const reportData: ExceptionErrorEvent = {
    ...createErrorBase(ctx),
    eventType: 'vue_error',
    payload: {
      exception: normalizeException(err),
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

export const vueErrorPlugin = (app: Vue): MonitorPlugin => ({
  name: 'error:vue',
  setup(ctx) {
    if (!app?.config) return

    const originalErrorHandler = app.config.errorHandler
    const errorHandler: VueErrorHandler = (err, vm, info) => {
      reportVueError(ctx, err, vm, info)
      originalErrorHandler?.(err, vm, info)
    }
    app.config.errorHandler = errorHandler

    return () => {
      if (app.config.errorHandler === errorHandler) {
        app.config.errorHandler = originalErrorHandler
      }
    }
  },
})
