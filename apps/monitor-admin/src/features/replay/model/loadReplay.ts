import type { DecodeResult, ReplayClip } from './replayTypes'

export function loadReplay(encoded: string, signal: AbortSignal): Promise<ReplayClip> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./decodeReplay.worker.ts', import.meta.url), {
      type: 'module',
    })
    const stop = () => {
      worker.terminate()
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      stop()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      stop()
      reject(new Error('录屏读取超时，请重新加载。'))
    }, 10_000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) return abort()
    worker.onmessage = ({ data }: MessageEvent<DecodeResult>) => {
      stop()
      if (data.clip) resolve(data.clip)
      else reject(new Error(data.error))
    }
    worker.onerror = () => {
      stop()
      reject(new Error('录屏读取失败，请重新加载。'))
    }
    worker.postMessage(encoded)
  })
}
