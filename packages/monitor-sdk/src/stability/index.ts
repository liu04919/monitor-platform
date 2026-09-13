import { crashPlugin } from './heartbeat'
import type { HeartbeatOptions } from './heartbeat/types'
import { stutterPlugin, type StutterOptions } from './stutter'
import { whiteScreenPlugin, type WhiteScreenOptions } from './whiteScreen'
import type { MonitorPlugin } from '../types'

export { whiteScreenPlugin, crashPlugin, stutterPlugin }
export type { WhiteScreenOptions, HeartbeatOptions, StutterOptions }

export interface StabilityOptions {
  whiteScreen?: WhiteScreenOptions
  heartbeat?: HeartbeatOptions
  stutter?: StutterOptions
}

export const stabilityPlugins = (options: StabilityOptions = {}): MonitorPlugin[] => [
  whiteScreenPlugin(options.whiteScreen),
  stutterPlugin(options.stutter),
  crashPlugin(options.heartbeat),
]
