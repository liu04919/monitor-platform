import type { MonitorEvent } from '../types'

const cache: MonitorEvent[] = []

export function getCache(): MonitorEvent[] {
  return cache
}

export function addCache(event: MonitorEvent): void {
  cache.push(event)
}

export function clearCache(): void {
  cache.length = 0
}
