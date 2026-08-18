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

export const REPORT_URL = 'http://127.0.0.1:8080/api/v1/events/batch'

export const monitor = createMonitor({
  url: REPORT_URL,
  projectName: 'monitor',
  appId: 'monitor-local',
  publicKey: 'pk_local_development',
  userId: `local-${new Date().toISOString().slice(0, 10)}`,
  batchSize: 1,
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
