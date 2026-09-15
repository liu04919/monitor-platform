import { decodeReplay } from './decodeReplay'
import type { DecodeResult } from './replayTypes'

// 解压和 JSON 解析不占用管理端主线程；离开页签时直接终止 Worker。
self.onmessage = (event: MessageEvent<string>) => {
  let result: DecodeResult
  try {
    result = { clip: decodeReplay(event.data) }
  } catch (error) {
    result = { error: error instanceof Error ? error.message : '录屏读取失败，请重新加载。' }
  }
  self.postMessage(result)
}
