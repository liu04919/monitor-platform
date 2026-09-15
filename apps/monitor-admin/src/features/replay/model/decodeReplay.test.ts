/// <reference types="node" />
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeReplay } from './decodeReplay'

const meta = {
  type: 4,
  timestamp: 1000,
  data: { href: 'https://example.com', width: 1440, height: 900 },
}
const snapshot = {
  type: 2,
  timestamp: 1001,
  data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { top: 0, left: 0 } },
}
const last = { type: 5, timestamp: 4000, data: { tag: '点击保存', payload: { text: '中文与🙂' } } }

// 用独立的 gzip 实现生成夹具：直接压缩 UTF-8 JSON，再转一层 Base64。
export function encodeFixture(value: unknown) {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64')
}

describe('decodeReplay', () => {
  it('解码 SDK 格式并保留中文、快照、事件顺序和时间范围', () => {
    expect(decodeReplay(encodeFixture([meta, snapshot, last]))).toEqual({
      events: [meta, snapshot, last],
      startTime: 1000,
      endTime: 4000,
      width: 1440,
      height: 900,
    })
  })
  it('允许 checkout 片段以完整快照开始', () => {
    expect(
      decodeReplay(encodeFixture([snapshot, { ...meta, timestamp: 2000 }, last])).startTime,
    ).toBe(1001)
  })
  it.each(['!!!', '{"events":[]}', 'H4sI', ''])('拒绝错误压缩格式 %s', (value) => {
    expect(() => decodeReplay(value)).toThrow(/编码|压缩/)
  })
  it('拒绝截断或校验失败的 gzip', () => {
    const compressed = Buffer.from(encodeFixture([meta, snapshot, last]), 'base64')
    expect(() => decodeReplay(compressed.subarray(0, -8).toString('base64'))).toThrow(/不完整/)
    compressed[compressed.length - 6] ^= 255
    expect(() => decodeReplay(compressed.toString('base64'))).toThrow(/不完整/)
  })
  it.each([null, [], [meta], [meta, last], [snapshot, last]].map((value) => ({ value })))(
    '拒绝不完整片段 %#',
    ({ value }) => {
      expect(() => decodeReplay(encodeFixture(value))).toThrow(/不完整|缺少/)
    },
  )
  it.each(
    [
      [meta, snapshot, { ...last, timestamp: 900 }],
      [{ ...meta, timestamp: -1 }, snapshot],
      [meta, snapshot, { ...last, type: 999 }],
      [meta, snapshot, { ...last, data: null }],
    ].map((value) => ({ value })),
  )('拒绝乱序或非法事件 %#', ({ value }) => {
    expect(() => decodeReplay(encodeFixture(value))).toThrow(/格式/)
  })
  it('拒绝异常视口', () => {
    expect(() =>
      decodeReplay(encodeFixture([{ ...meta, data: { width: 1e9, height: 900 } }, snapshot])),
    ).toThrow(/视口/)
  })
  it('拒绝非法 JSON 和无效 UTF-8', () => {
    expect(() => decodeReplay(gzipSync('!!!').toString('base64'))).toThrow(/损坏/)
    expect(() => decodeReplay(gzipSync(Buffer.from([0xc3, 0x28])).toString('base64'))).toThrow(
      /损坏/,
    )
  })
  it('拒绝 gzip 内额外包裹的 Base64，不保留双格式读取', () => {
    const innerBase64 = Buffer.from(JSON.stringify([meta, snapshot, last]), 'utf8').toString(
      'base64',
    )
    expect(() => decodeReplay(gzipSync(innerBase64).toString('base64'))).toThrow(/损坏/)
  })
  it('在解压过程中限制展开大小', () => {
    const bomb = gzipSync('A'.repeat(16 * 1024 * 1024 + 1)).toString('base64')
    expect(() => decodeReplay(bomb)).toThrow(/解压后过大/)
  })
  it('限制输入大小和事件总数', () => {
    expect(() => decodeReplay('A'.repeat(1024 * 1024 + 1))).toThrow(/文件过大/)
    expect(() =>
      decodeReplay(encodeFixture([meta, snapshot, ...Array(50_000).fill(last)])),
    ).toThrow(/事件过多/)
  })
})
