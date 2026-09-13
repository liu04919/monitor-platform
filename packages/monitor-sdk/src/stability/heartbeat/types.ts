import type { Breadcrumb, ConfigType, MonitorEvent, ReportDrop } from '../../types'

export const TRANSPORT_CALLBACKS = [
  'reportBefore',
  'reportAfter',
  'reportSuccess',
  'reportFail',
] as const
type TransportCallback = (typeof TRANSPORT_CALLBACKS)[number]

export interface HeartbeatOptions {
  /** 心跳发送间隔，默认 5000 毫秒。 */
  intervalMs?: number
  /** 距离上次回复的超时门槛，默认 15000 毫秒，必须大于 intervalMs。 */
  timeoutMs?: number
  /** 诊断快照单独更新的间隔，默认 10000 毫秒。 */
  snapshotIntervalMs?: number
}

export function heartbeatOptions(input: HeartbeatOptions): Required<HeartbeatOptions> {
  const options = {
    intervalMs: input.intervalMs ?? 5000,
    timeoutMs: input.timeoutMs ?? 15000,
    snapshotIntervalMs: input.snapshotIntervalMs ?? 10000,
  }
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isFinite(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(`[monitor-sdk] ${name} 必须是有效的正毫秒数`)
    }
  }
  if (options.timeoutMs <= options.intervalMs) {
    throw new Error('[monitor-sdk] timeoutMs 必须大于 intervalMs')
  }
  return options
}

// 只跨线程传递可序列化配置，不传插件、回调或整个 MonitorContext。
export type HeartbeatConfig = Pick<
  ConfigType,
  'url' | 'appId' | 'projectName' | 'publicKey' | 'userId' | 'transport'
>

export interface HeartbeatSnapshot {
  pageUrl: string
  breadcrumbs: Breadcrumb[]
  replayData: string
}

export type MainMessage =
  | {
      type: 'init'
      config: HeartbeatConfig
      options: Required<HeartbeatOptions>
      pageUrl: string
      active: boolean
      callbacks: TransportCallback[]
    }
  | { type: 'pong'; id: number }
  | { type: 'active'; active: boolean }
  | { type: 'snapshot'; snapshot: HeartbeatSnapshot }

export type WorkerMessage =
  | { type: 'ping'; id: number }
  | { type: 'drop'; info: ReportDrop }
  | { type: 'callback'; name: TransportCallback; events: MonitorEvent[] }
