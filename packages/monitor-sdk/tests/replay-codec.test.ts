import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeReplay, unzipRecordscreen } from '../src/replay/codec'

const events = [
  { type: 5, timestamp: 123, data: { tag: '点击保存🙂', payload: { text: '换行\n与 "引号"' } } },
]

describe('录屏编码', () => {
  it('gzip 内容就是 UTF-8 JSON，而不是内层 Base64', () => {
    const compressed = Buffer.from(encodeReplay(events), 'base64')
    expect([...compressed.subarray(0, 2)]).toEqual([0x1f, 0x8b])
    expect(gunzipSync(compressed).toString('utf8')).toBe(JSON.stringify(events))
  })

  it('解码独立实现生成的数据，保留中文、emoji 和嵌套字段', () => {
    const encoded = gzipSync(Buffer.from(JSON.stringify(events), 'utf8')).toString('base64')
    expect(unzipRecordscreen(encoded)).toEqual(events)
  })

  it('空数组也使用同一编码格式', () => {
    expect(unzipRecordscreen(encodeReplay([]))).toEqual([])
  })

  it('较大内容往返不依赖展开参数或手工切片拼接字符串', () => {
    const large = [{ ...events[0], data: { text: '中文🙂'.repeat(100_000) } }]
    expect(unzipRecordscreen(encodeReplay(large))).toEqual(large)
  })

  it('拒绝截断的压缩包、非法 JSON 和无效 UTF-8', () => {
    const compressed = Buffer.from(encodeReplay(events), 'base64')
    expect(() => unzipRecordscreen(compressed.subarray(0, -8).toString('base64'))).toThrow()
    expect(() => unzipRecordscreen(gzipSync('not json').toString('base64'))).toThrow()
    expect(() =>
      unzipRecordscreen(gzipSync(Buffer.from([0xc3, 0x28])).toString('base64')),
    ).toThrow()
  })

  it('不读取 gzip 内额外包裹的 Base64', () => {
    const innerBase64 = Buffer.from(JSON.stringify(events), 'utf8').toString('base64')
    expect(() => unzipRecordscreen(gzipSync(innerBase64).toString('base64'))).toThrow()
  })
})
