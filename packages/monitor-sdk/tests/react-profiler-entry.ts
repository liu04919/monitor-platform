import { createElement, useState } from 'react'
import type { ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { createMonitor } from '../dist/index.js'
import { reactProfilerPlugin, REACT_PROFILER_CAPABILITY } from '../dist/plugins/index.js'
import type { MonitorProfilerProps } from '../dist/plugins/index.js'
import type { MonitorEvent } from '../src/types'

// 此入口只用于浏览器回归。React 构建模式由测试脚本选择，不修改 Demo 配置。
const id = location.pathname.slice(1)
const events: MonitorEvent[] = []
const monitor = createMonitor({
  url: `/collect/${id}`,
  appId: id,
  projectName: id,
  publicKey: `key-${id}`,
  batchSize: 1,
  plugins: [
    reactProfilerPlugin({ reportIntervalMs: 120, maxCommitCount: 20, slowRenderThresholdMs: 0 }),
  ],
  reportSuccess(batch) {
    events.push(...batch)
  },
})
const MonitorProfiler =
  monitor.getCapability<ComponentType<MonitorProfilerProps>>(REACT_PROFILER_CAPABILITY)!

function Counter() {
  const [count, setCount] = useState(0)
  return createElement(
    'button',
    { id: 'counter', onClick: () => setCount((value) => value + 1) },
    count,
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(createElement(MonitorProfiler, { id: 'counter', children: createElement(Counter) }))
Object.assign(window, {
  profilerTest: {
    events,
    destroy: () => monitor.destroy(),
    unmount: () => root.unmount(),
  },
})
