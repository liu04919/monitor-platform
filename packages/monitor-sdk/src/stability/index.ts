import { crashPlugin } from './heartbeat'
import type { HeartbeatOptions } from './heartbeat/types'
import stutterLoop from './stutterLoop'
import { whiteScreenPlugin, type WhiteScreenOptions } from './whiteScreen'
import type { MonitorPlugin } from '../types'

export { whiteScreenPlugin, crashPlugin }
export type { WhiteScreenOptions, HeartbeatOptions }

export interface StabilityOptions {
  whiteScreen?: WhiteScreenOptions
  heartbeat?: HeartbeatOptions
}

export const stutterPlugin = (): MonitorPlugin => ({
  name: 'stability:stutter',
  setup: stutterLoop,
})

export const stabilityPlugins = (options: StabilityOptions = {}): MonitorPlugin[] => [
  whiteScreenPlugin(options.whiteScreen),
  stutterPlugin(),
  crashPlugin(options.heartbeat),
]
