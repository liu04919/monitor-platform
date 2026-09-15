import { Inflate } from 'pako'
import type { ReplayClip, ReplayEvent } from './replayTypes'

// 服务端批次最多 1 MiB；解压上限另设，防止小压缩包展开成巨量数据。
const MAX_ENCODED_LENGTH = 1024 * 1024
const MAX_INFLATED_LENGTH = 16 * 1024 * 1024
const MAX_EVENTS = 50_000

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('录屏编码无效，无法播放。')
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function decodeReplay(encoded: string): ReplayClip {
  if (encoded.length > MAX_ENCODED_LENGTH) throw new Error('录屏文件过大，无法播放。')

  // 与 SDK 一致：Base64 → gzip → UTF-8 JSON，不猜测其他编码格式。
  const compressed = fromBase64(encoded)
  if (compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
    throw new Error('录屏压缩数据无效，无法播放。')
  }
  const inflater = new Inflate({ chunkSize: 64 * 1024 })
  const chunks: Uint8Array[] = []
  let length = 0
  let completed = false
  inflater.onData = (chunk) => {
    const bytes = chunk as Uint8Array
    length += bytes.length
    if (length > MAX_INFLATED_LENGTH) throw new Error('录屏解压后过大，无法播放。')
    chunks.push(bytes)
  }
  inflater.onEnd = (status) => {
    completed = status === 0
  }
  inflater.push(compressed, true)
  if (!completed) throw new Error('录屏压缩数据不完整，无法播放。')

  const inflated = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    inflated.set(chunk, offset)
    offset += chunk.length
  }

  let value: unknown
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(inflated)
    value = JSON.parse(json)
  } catch {
    throw new Error('录屏内容损坏，无法播放。')
  }
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('录屏片段不完整，无法播放。')
  }
  if (value.length > MAX_EVENTS) throw new Error('录屏事件过多，无法播放。')

  let previousTime = -1
  let hasSnapshot = false
  let width = 0
  let height = 0
  for (const event of value) {
    if (
      !isObject(event) ||
      !Number.isInteger(event.type) ||
      Number(event.type) < 0 ||
      Number(event.type) > 6 ||
      typeof event.timestamp !== 'number' ||
      !Number.isFinite(event.timestamp) ||
      event.timestamp < 0 ||
      event.timestamp < previousTime ||
      !isObject(event.data)
    )
      throw new Error('录屏事件格式无效，无法播放。')
    previousTime = event.timestamp
    if (event.type === 2 && isObject(event.data.node) && event.data.node.type === 0) {
      hasSnapshot = true
    }
    // checkout 分段可能从 FullSnapshot 开始，Meta 不一定是第一个事件。
    if (event.type === 4 && !width) {
      width = Number(event.data.width)
      height = Number(event.data.height)
    }
  }
  if (
    !hasSnapshot ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 16384 ||
    height > 16384
  ) {
    throw new Error('录屏缺少完整页面快照或视口信息，无法播放。')
  }
  const events = value as ReplayEvent[]
  return {
    events,
    startTime: events[0].timestamp,
    endTime: events.at(-1)!.timestamp,
    width,
    height,
  }
}
