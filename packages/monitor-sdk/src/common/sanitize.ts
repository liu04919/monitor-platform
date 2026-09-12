// 自动采集只保留定位所需信息，不携带 URL 凭据、查询参数或 token fragment。
export function sanitizeUrl(input: string): string {
  try {
    const url = new URL(input, typeof location === 'undefined' ? undefined : location.href)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.username = ''
    url.password = ''
    url.search = ''
    const fragment = url.hash.split('?')[0]
    url.hash = fragment.includes('=') ? '' : fragment
    return url.href.slice(0, 2048)
  } catch {
    return ''
  }
}

const sensitiveKey = /password|passwd|token|authorization|cookie|secret/i

// 自定义数据只接受有限深度、有限长度的 JSON 值；不保存 DOM、函数或原始对象引用。
export function sanitizeData(input: Record<string, unknown>): Record<string, unknown> {
  const seen = new WeakSet<object>()
  const copy = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return value.slice(0, 256)
    if (typeof value === 'boolean' || value === null) return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    if (typeof value !== 'object' || depth > 4 || seen.has(value)) return undefined
    seen.add(value)
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => copy(item, depth + 1) ?? null)
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      return undefined
    const result: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(value).slice(0, 20)) {
      if (sensitiveKey.test(key) || key === '__proto__') continue
      const item = (value as Record<string, unknown>)[key]
      result[key.slice(0, 80)] =
        typeof item === 'string' && /^(url|href|from|to|referrer|pageUrl)$/i.test(key)
          ? sanitizeUrl(item)
          : copy(item, depth + 1)
    }
    return result
  }
  return (copy(input, 0) as Record<string, unknown> | undefined) || {}
}
