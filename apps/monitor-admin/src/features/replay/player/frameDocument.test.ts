import { describe, expect, it } from 'vitest'
import { createFrameSource } from './frameDocument'

describe('replay document isolation', () => {
  it('使用独立源 data URL，而不是会继承管理端源的文档', () => {
    expect(createFrameSource()).toMatch(/^data:text\/html;charset=utf-8,/)
  })
  it('仅允许带随机 nonce 的可信脚本，禁止连接和表单提交', () => {
    const html = decodeURIComponent(createFrameSource().split(',')[1])
    const nonce = html.match(/script-src 'nonce-([a-f0-9]+)'/)?.[1]
    expect(nonce).toHaveLength(32)
    expect(html.match(new RegExp(`<script nonce="${nonce}">`, 'g'))).toHaveLength(2)
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain("form-action 'none'")
    expect(html).not.toContain("script-src 'unsafe-inline'")
    expect(createFrameSource()).not.toContain(nonce)
  })
})
