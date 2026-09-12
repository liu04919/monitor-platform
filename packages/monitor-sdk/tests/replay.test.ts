import { describe, expect, it, vi } from 'vitest'
import { record } from 'rrweb'
import { createMonitor } from '../src/core'
import { recordScreenPlugin } from '../src/replay'
import { unzipRecordscreen } from '../src/common/utils'
import { capture } from './helpers'

vi.mock('rrweb', () => ({ record: vi.fn(() => vi.fn()) }))
vi.mock('../src/transport', () => ({
  ReportTransport: class {
    report() {}
    destroy() {}
    async flush() {}
  },
}))

describe('独立录屏插件', () => {
  it('显式启动录制，保持压缩快照协议，并随实例销毁停止录制', () => {
    const test = capture()
    const monitor = createMonitor({ plugins: [test.plugin, recordScreenPlugin()] })
    try {
      expect(record).toHaveBeenCalledTimes(1)
      const options = vi.mocked(record).mock.calls[0][0]!
      expect(options.checkoutEveryNms).toBe(3000)
      const meta = {
        type: 4 as const,
        timestamp: 123,
        data: { href: 'http://localhost/', width: 800, height: 600 },
      }
      options.emit!(meta)
      expect(unzipRecordscreen(test.context().getReplayData())).toEqual([meta])
      monitor.destroy()
      monitor.destroy()
      expect(vi.mocked(record).mock.results[0].value).toHaveBeenCalledTimes(1)
      expect(test.context().getReplayData()).toBe('')
    } finally {
      monitor.destroy()
    }
  })
})
