import { APIError } from '@/shared/api/apiClient'

const messages: Record<string, string> = {
  EMAIL_CONFLICT: '这个邮箱已经注册，请直接登录。',
  INVALID_CREDENTIALS: '邮箱或密码不正确。',
  INVALID_EMAIL: '请输入有效的邮箱地址。',
  INVALID_PASSWORD: '密码长度必须在 8 到 128 个字符之间。',
  SESSION_UNAVAILABLE: '登录服务暂时不可用，请稍后重试。',
  UNAUTHENTICATED: '登录状态已失效，请重新登录。',
}

export function authErrorMessage(error: Error) {
  if (error instanceof APIError && error.code && messages[error.code]) {
    return messages[error.code]
  }
  return error.message
}
