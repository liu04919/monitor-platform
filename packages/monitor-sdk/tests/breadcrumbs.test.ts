import { describe, expect, it } from 'vitest'
import { BreadcrumbStore } from '../src/breadcrumbs'
import { sanitizeUrl } from '../src/common/sanitize'

describe('BreadcrumbStore', () => {
  it('按数量淘汰最旧轨迹，调用者不能修改内部快照', () => {
    const store = new BreadcrumbStore({ maxBreadcrumbs: 2 })
    const data = { nested: { value: 1 } }
    store.add({ category: 'custom', message: 'first' })
    store.add({ category: 'custom', message: 'second', data })
    data.nested.value = 99
    store.add({ category: 'custom', message: 'third' })
    const snapshot = store.snapshot()
    expect(snapshot.map((item) => item.message)).toEqual(['second', 'third'])
    expect(snapshot[0].data).toEqual({ nested: { value: 1 } })
    ;(snapshot[0].data!.nested as { value: number }).value = 88
    expect(store.snapshot()[0].data).toEqual({ nested: { value: 1 } })
    store.clear()
    expect(store.snapshot()).toEqual([])
  })

  it('写入前过滤、脱敏，hook 抛错不影响调用者', () => {
    const store = new BreadcrumbStore({
      beforeBreadcrumb: (item) => {
        if (item.message === 'drop') return null
        if (item.message === 'throw') throw new Error('hook failed')
        item.message = 'redacted'
        return item
      },
    })
    store.add({ category: 'custom', message: 'drop' })
    expect(() => store.add({ category: 'custom', message: 'throw' })).not.toThrow()
    store.add({
      category: 'http',
      message: 'request',
      data: {
        url: 'https://user:pass@example.com/api?token=secret',
        accessToken: 'secret',
        nested: { password: 'secret', success: true },
      },
    })
    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        message: 'redacted',
        data: { url: 'https://example.com/api', nested: { success: true } },
      }),
    ])
  })

  it('限制字节数并处理循环引用、非法时间和禁用状态', () => {
    const store = new BreadcrumbStore({ maxBreadcrumbs: 100 })
    const circular: Record<string, unknown> = { ok: true }
    circular.self = circular
    store.add({ category: 'custom', data: circular })
    expect(store.snapshot()[0].data).toEqual({ ok: true })
    store.add({ category: 'custom', timestamp: -1 })
    store.add({
      category: 'custom',
      data: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`field${i}`, 'x'.repeat(256)]),
      ),
    })
    expect(store.snapshot()).toHaveLength(1)
    for (let i = 0; i < 100; i++)
      store.add({ category: 'custom', message: String(i), data: { text: '字'.repeat(256) } })
    const bytes = store
      .snapshot()
      .reduce((sum, item) => sum + new TextEncoder().encode(JSON.stringify(item)).length, 0)
    expect(bytes).toBeLessThanOrEqual(32 * 1024)
    expect(store.snapshot().at(-1)?.message).toBe('99')
    const disabled = new BreadcrumbStore({ maxBreadcrumbs: 0 })
    disabled.add({ category: 'click' })
    expect(disabled.snapshot()).toEqual([])
  })

  it('误传异步 hook 时拒绝该轨迹且处理 rejection', async () => {
    const store = new BreadcrumbStore({
      // @ts-expect-error 公开契约要求同步，仍测试 JavaScript 调用方的误用。
      beforeBreadcrumb: async () => {
        throw new Error('async hook')
      },
    })
    store.add({ category: 'custom' })
    await Promise.resolve()
    expect(store.snapshot()).toEqual([])
  })
})

describe('URL 最小化', () => {
  it('移除凭据和参数，保留 hash 路由，拒绝非 HTTP 地址', () => {
    expect(sanitizeUrl('https://user:pass@example.com/app?token=secret#/settings?q=secret')).toBe(
      'https://example.com/app#/settings',
    )
    expect(sanitizeUrl('https://example.com/#access_token=secret')).toBe('https://example.com/')
    expect(sanitizeUrl('javascript:alert(1)')).toBe('')
  })
})
