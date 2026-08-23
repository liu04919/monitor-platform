import { APIError } from '@/shared/api/apiClient'

export function issueErrorMessage(error: unknown) {
  if (error instanceof APIError) return error.message
  if (error instanceof Error) return error.message
  return '发生了未知错误，请稍后重试。'
}
