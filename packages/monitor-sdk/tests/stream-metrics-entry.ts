import { createMonitor } from '../dist/index.js'
import { aiStreamPlugin } from '../dist/plugins/index.js'
import type { MonitorEvent } from '../src/types'

// 独立测试页使用真实 SDK 产物、IndexedDB 与 HTTP 投递，不连接 Go / 项目数据库。
const events: MonitorEvent[] = []
const dropped: unknown[] = []
const nativeFetch = window.fetch.bind(window)
const monitor = createMonitor({
  url: '/collect',
  appId: 'stream-test',
  projectName: 'stream-test',
  publicKey: 'stream-key',
  batchSize: 1,
  plugins: [aiStreamPlugin({ urlPatterns: ['/api/'], stallThreshold: 150 })],
  reportSuccess(batch) {
    events.push(...batch)
  },
  reportDrop(info) {
    dropped.push(info)
  },
})

Object.assign(window, {
  streamTest: { events, dropped, nativeFetch, destroy: () => monitor.destroy() },
})
