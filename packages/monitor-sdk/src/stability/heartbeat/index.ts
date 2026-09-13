import { safely } from '../../common/safe'
import { sanitizeUrl } from '../../common/sanitize'
import { transportOptions } from '../../transport/types'
import type { MonitorContext, MonitorPlugin } from '../../types'
import {
  heartbeatOptions,
  TRANSPORT_CALLBACKS,
  type HeartbeatOptions,
  type HeartbeatSnapshot,
  type MainMessage,
  type WorkerMessage,
} from './types'

// 构建时把独立的 worker.ts 编译、打包后内嵌；使用 SDK 的应用不需要额外配置 Worker 路径。
declare const __MONITOR_HEARTBEAT_WORKER__: string

export function crashPlugin(input: HeartbeatOptions = {}): MonitorPlugin {
  const options = heartbeatOptions(input)
  return { name: 'stability:crash', setup: (ctx) => setupHeartbeat(ctx, options) }
}

function setupHeartbeat(ctx: MonitorContext, options: Required<HeartbeatOptions>): () => void {
  if (typeof Worker === 'undefined') return () => {}

  const config = ctx.getConfig()
  const limits = transportOptions(config.transport)
  let worker: Worker | undefined
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined
  let pageActive = true
  let destroyed = false

  function stopWorker(): void {
    clearTimeout(snapshotTimer)
    snapshotTimer = undefined
    worker?.terminate()
    worker = undefined
  }

  function post(message: MainMessage): void {
    try {
      worker?.postMessage(message)
    } catch (error) {
      stopWorker()
      console.warn('[monitor-sdk] 心跳 Worker 通信失败，已停止检测', error)
    }
  }

  function updateSnapshot(): void {
    snapshotTimer = undefined
    if (!worker || destroyed || !pageActive || document.hidden) return
    const snapshot: HeartbeatSnapshot = {
      pageUrl: sanitizeUrl(window.location.href),
      breadcrumbs: ctx.getBreadcrumbs(),
      replayData: '',
    }
    // 录屏提供器异常不能影响心跳；快照只在独立定时任务中生成。
    safely(() => {
      snapshot.replayData = ctx.getReplayData()
    })
    const bytes = () => new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
    // 留一半批次预算给事件及批次元数据。省略过大的附件，不截断压缩字符串。
    if (bytes() > limits.maxBatchBytes / 2) snapshot.replayData = ''
    if (bytes() > limits.maxBatchBytes / 2) snapshot.breadcrumbs = []
    post({ type: 'snapshot', snapshot })
    if (worker) snapshotTimer = setTimeout(updateSnapshot, options.snapshotIntervalMs)
  }

  function startWorker(): void {
    if (worker || destroyed) return
    let url: string | undefined
    try {
      url = URL.createObjectURL(
        new Blob([__MONITOR_HEARTBEAT_WORKER__], { type: 'text/javascript' }),
      )
      const currentWorker = new Worker(url)
      worker = currentWorker
      currentWorker.onerror = (event) => {
        if (worker !== currentWorker) return
        event.preventDefault()
        stopWorker()
        console.warn('[monitor-sdk] 心跳 Worker 启动或运行失败')
      }
      currentWorker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (worker !== currentWorker) return
        if (data.type === 'ping') {
          // 先立即回复，绝不在心跳回调里压缩录屏。
          if (pageActive && !document.hidden) post({ type: 'pong', id: data.id })
        } else if (data.type === 'drop') {
          safely(() => config.reportDrop?.(data.info))
          console.warn('[monitor-sdk] Worker 批次未能投递', data.info.reason)
        } else if (data.type === 'callback') {
          safely(() => config[data.name]?.(data.events))
        }
      }
      post({
        type: 'init',
        config: {
          url: config.url,
          appId: config.appId,
          projectName: config.projectName,
          publicKey: config.publicKey,
          userId: config.userId,
          transport: limits,
        },
        options,
        callbacks: TRANSPORT_CALLBACKS.filter((name) => typeof config[name] === 'function'),
        pageUrl: sanitizeUrl(window.location.href),
        active: !document.hidden,
      })
    } catch (error) {
      stopWorker()
      console.warn('[monitor-sdk] 无法创建心跳 Worker，请检查浏览器支持及 worker-src 策略', error)
    } finally {
      if (url) URL.revokeObjectURL(url)
    }
  }

  function syncVisibility(): void {
    clearTimeout(snapshotTimer)
    snapshotTimer = undefined
    if (destroyed || !pageActive) return
    startWorker()
    post({ type: 'active', active: !document.hidden })
    if (worker && !document.hidden) snapshotTimer = setTimeout(updateSnapshot, 0)
  }

  ctx.on(document, 'visibilitychange', syncVisibility)
  ctx.on(window, 'pagehide', () => {
    pageActive = false
    stopWorker()
  })
  ctx.on(window, 'pageshow', () => {
    pageActive = true
    syncVisibility()
  })
  ctx.on(document, 'freeze', () => {
    pageActive = false
    stopWorker()
  })
  ctx.on(document, 'resume', () => {
    pageActive = true
    syncVisibility()
  })
  syncVisibility()
  return () => {
    destroyed = true
    stopWorker()
  }
}
