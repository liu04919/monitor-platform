// 用真实的生产构建测试传输，采集器另行打包以避免加载无关的 React/rrweb 插件。
export { createMonitor } from '../dist/index.js'
import instrumentFetch from '../src/performance/fetch'
export const fetchPlugin = { name: 'browser-test:fetch', setup: instrumentFetch }
export { behaviorPlugins } from '../src/behavior'
import instrumentXHR from '../src/performance/xhr'
export const xhrPlugin = { name: 'browser-test:xhr', setup: instrumentXHR }
import initErrorEventListener from '../src/error/initErrorEventListener'
export const errorPlugin = { name: 'browser-test:errors', setup: initErrorEventListener }
