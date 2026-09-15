export const timePresets = [
  { value: '1h', label: '最近 1 小时', duration: 60 * 60 * 1000 },
  { value: '24h', label: '最近 24 小时', duration: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '最近 7 天', duration: 7 * 24 * 60 * 60 * 1000 },
] as const

export type TimePreset = (typeof timePresets)[number]['value']
export interface TimeRange {
  from: number
  to: number
  preset: TimePreset | 'custom'
}

export const maxQueryTime = 4102444800000

export function isValidTimeRange(from: number, to: number) {
  return (
    Number.isSafeInteger(from) &&
    Number.isSafeInteger(to) &&
    from >= 0 &&
    from < to &&
    to <= maxQueryTime
  )
}

export function presetTimeRange(preset: TimePreset, now = Date.now()): TimeRange {
  const duration = timePresets.find((item) => item.value === preset)!.duration
  return { from: now - duration, to: now, preset }
}

export function readTimeRange(params: URLSearchParams): TimeRange | null {
  const fromText = params.get('from') || ''
  const toText = params.get('to') || ''
  if (!/^\d+$/.test(fromText) || !/^\d+$/.test(toText)) return null
  const from = Number(fromText)
  const to = Number(toText)
  if (!isValidTimeRange(from, to)) return null
  const preset = timePresets.find(
    (item) => item.value === params.get('range') && item.duration === to - from,
  )
  return { from, to, preset: preset?.value || 'custom' }
}

export function withTimeRange(params: URLSearchParams, range: TimeRange) {
  const next = new URLSearchParams(params)
  next.set('from', String(range.from))
  next.set('to', String(range.to))
  next.set('range', range.preset)
  next.delete('page')
  next.delete('issuesPage')
  return next
}

// 详情页只携带列表筛选字段，不把录屏页签等详情状态带回列表。
export function listSearch(params: URLSearchParams) {
  const result = new URLSearchParams()
  for (const key of [
    'from',
    'to',
    'range',
    'category',
    'eventType',
    'page',
    'pageSize',
    'issuesPage',
    'issuesPageSize',
  ]) {
    const value = params.get(key)
    if (value) result.set(key, value)
  }
  return result.size ? `?${result}` : ''
}

export function localDateTime(value: number) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function parseLocalDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return NaN
  const timestamp = new Date(value).getTime()
  const normalized = value.length === 16 ? `${value}:00` : value
  return Number.isFinite(timestamp) && localDateTime(timestamp) === normalized ? timestamp : NaN
}
