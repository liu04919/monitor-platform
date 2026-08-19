import type { EventDetail, EventSummary } from '@/features/events/model/eventTypes'
import { APIError } from '@/shared/api/apiClient'

export function displayEventName(event: Pick<EventSummary, 'eventType'> & { message?: string }) {
  return event.message?.trim() || event.eventType.replaceAll('_', ' ')
}

export function detailEventName(event: EventDetail) {
  const payloadMessage = typeof event.payload.message === 'string' ? event.payload.message.trim() : ''
  const exception = event.payload.exception
  const exceptionMessage = typeof exception === 'object' && exception !== null && 'message' in exception && typeof exception.message === 'string'
    ? exception.message.trim()
    : ''
  return event.message?.trim() || payloadMessage || exceptionMessage || event.eventType.replaceAll('_', ' ')
}

export function eventErrorMessage(error: unknown) {
  if (error instanceof APIError) return error.message
  if (error instanceof Error) return error.message
  return '发生了未知错误，请稍后重试。'
}
