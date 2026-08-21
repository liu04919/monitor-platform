import { createMonitor } from 'minitor-sdk'
import {
  aiStreamPlugin,
  behaviorPlugins,
  browserErrorPlugins,
  performancePlugins,
  reactErrorPlugin,
  reactProfilerPlugin,
  stallPlugin,
} from 'minitor-sdk/plugins'

export const REPORT_URL = import.meta.env.VITE_MONITOR_REPORT_URL?.trim() || 'http://127.0.0.1:8080/api/v1/events/batch'

const projectId = import.meta.env.VITE_MONITOR_PROJECT_ID?.trim()
const projectName = import.meta.env.VITE_MONITOR_PROJECT_NAME?.trim()
const publicKey = import.meta.env.VITE_MONITOR_PUBLIC_KEY?.trim()

if (!projectId || !projectName || !publicKey) {
  throw new Error('monitor-demo 缺少项目配置，请复制 .env.example 为 .env.local 并填写管理端创建项目后返回的 SDK 配置。')
}

const searchParams = new URLSearchParams(window.location.search)

export const BEACON_TEST_MODE = searchParams.get('beacon') === '1'
export const BEACON_TEST_RUN_ID = searchParams.get('runId') || crypto.randomUUID()

export const monitor = createMonitor({
  url: REPORT_URL,
  projectName,
  appId: projectId,
  publicKey,
  userId: `local-${new Date().toISOString().slice(0, 10)}`,
  // Beacon 测试要把事件留在内存队列中，等 pagehide 时由 sendBeacon 发送。
  batchSize: BEACON_TEST_MODE ? 100 : 1,
  plugins: [
    ...behaviorPlugins(),
    ...browserErrorPlugins(),
    reactErrorPlugin(),
    ...performancePlugins(),
    aiStreamPlugin({
      urlPatterns: ['/api/demo/chat'],
      stallThreshold: 500,
      getMeta: () => ({ scenario: 'local-stream-test' }),
    }),
    reactProfilerPlugin({
      reportInterval: 700,
      maxCommitCount: 4,
      slowCommitThreshold: 1,
    }),
    stallPlugin({
      longTaskThreshold: 80,
      rafGapThreshold: 120,
      reportInterval: 500,
    }),
  ],
  reportSuccess: (events: unknown[]) => {
    window.dispatchEvent(new CustomEvent('monitor:reported', { detail: events }))
  },
  reportFail: () => {
    window.dispatchEvent(new Event('monitor:report-failed'))
  },
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    monitor.destroy()
  })
}
