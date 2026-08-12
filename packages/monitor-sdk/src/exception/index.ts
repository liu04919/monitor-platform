import whiteScreenLoop from './whiteScreenLoop'
import stutterLoop from './stutterLoop'
import crashLoop from './crashLoop'
import { MonitorPlugin } from '../types'

export const whiteScreenPlugin = (): MonitorPlugin => ({
  name: 'exception:white-screen',
  setup: whiteScreenLoop,
})

export const stutterPlugin = (): MonitorPlugin => ({
  name: 'exception:stutter',
  setup: stutterLoop,
})

export const crashPlugin = (): MonitorPlugin => ({
  name: 'exception:crash',
  setup: crashLoop,
})

export const exceptionPlugins = (): MonitorPlugin[] => [
  whiteScreenPlugin(),
  stutterPlugin(),
  // crashPlugin(),还未更新第二版本
]
