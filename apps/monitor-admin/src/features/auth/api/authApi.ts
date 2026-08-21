import { deleteRequest, getJSON, postJSON } from '@/shared/api/apiClient'
import type { AuthUser, Credentials } from '@/features/auth/model/authTypes'

export function register(credentials: Credentials) {
  return postJSON<AuthUser>('/auth/register', credentials)
}

export function login(credentials: Credentials) {
  return postJSON<AuthUser>('/auth/login', credentials)
}

export function getCurrentUser(signal?: AbortSignal) {
  return getJSON<AuthUser>('/auth/me', signal)
}

export function logout() {
  return deleteRequest('/auth/logout')
}
