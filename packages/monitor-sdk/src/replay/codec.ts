import pako from 'pako'
import { Base64 } from 'js-base64'

export function encodeReplay(events: readonly unknown[]): string {
  // 直接压缩 UTF-8 JSON；Base64 只用于将压缩字节放进 replayData 字符串。
  const json = JSON.stringify(events)
  const compressed = pako.gzip(new TextEncoder().encode(json))
  return Base64.fromUint8Array(compressed)
}

export function unzipRecordscreen(encoded: string): unknown {
  const compressed = Base64.toUint8Array(encoded)
  const bytes = pako.ungzip(compressed)
  const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return JSON.parse(json)
}
