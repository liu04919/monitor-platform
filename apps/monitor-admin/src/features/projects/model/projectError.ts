import { APIError } from '@/shared/api/apiClient'

export function projectErrorMessage(error: unknown) {
  if (error instanceof APIError && error.code === 'PROJECT_NOT_FOUND') {
    return '项目不存在，或者当前账号无权访问。'
  }
  if (error instanceof APIError) return error.message
  return error instanceof Error ? error.message : '项目暂时无法读取。'
}
