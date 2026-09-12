import type { MonitorPlugin } from '../types'
import { RecordScreen, replaySnapshot } from './recorder'

export const recordScreenPlugin = (): MonitorPlugin => ({
  name: 'replay:record-screen',
  setup(ctx) {
    const recorder = new RecordScreen()
    ctx.provide('replay:data', () => replaySnapshot(recorder))
    return () => recorder.close()
  },
})
