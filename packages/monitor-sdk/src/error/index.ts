import initErrorEventListener from './initErrorEventListener'
import createErrorBoundary from './reactError'
import initVueError, { Vue } from './vueError'
import { MonitorPlugin } from '../types'

export { createErrorBoundary, initErrorEventListener, initVueError }

export const jsErrorPlugin = (): MonitorPlugin => ({
  name: 'error:js',
  setup: (ctx) => {
    initErrorEventListener(ctx, { js: true, cors: true })
  },
})

export const promiseErrorPlugin = (): MonitorPlugin => ({
  name: 'error:promise',
  setup: (ctx) => {
    initErrorEventListener(ctx, { promise: true })
  },
})

export const resourceErrorPlugin = (): MonitorPlugin => ({
  name: 'error:resource',
  setup: (ctx) => {
    initErrorEventListener(ctx, { resource: true })
  },
})

export const browserErrorPlugins = (): MonitorPlugin[] => [
  jsErrorPlugin(),
  promiseErrorPlugin(),
  resourceErrorPlugin(),
]

export const vueErrorPlugin = (app: Vue): MonitorPlugin => ({
  name: 'error:vue',
  setup: (ctx) => {
    return initVueError(ctx, app)
  },
})

export const reactErrorPlugin = (): MonitorPlugin => ({
  name: 'error:react',
  setup: (ctx) => {
    ctx.provide('error:react-boundary', createErrorBoundary(ctx))
  },
})
