import { createEventBase } from '../common/event'
import { sanitizeData } from '../common/sanitize'
import type { BehaviorEvent, ConfigType } from '../types'

export function createCustomEvent(
  config: ConfigType,
  name: string,
  data: Record<string, unknown> = {},
): BehaviorEvent | undefined {
  const eventName = name.trim().slice(0, 128)
  if (!eventName) return
  return {
    ...createEventBase({ getConfig: () => config }),
    category: 'behavior',
    eventType: 'custom',
    payload: { message: eventName, data: { name: eventName, attributes: sanitizeData(data) } },
  }
}
