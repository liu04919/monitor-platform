import { queryOptions } from '@tanstack/react-query'
import { getCurrentUser } from '@/features/auth/api/authApi'

export const currentUserQueryKey = ['auth', 'current-user'] as const

export function currentUserQueryOptions() {
  return queryOptions({
    queryKey: currentUserQueryKey,
    queryFn: ({ signal }) => getCurrentUser(signal),
    retry: false,
    staleTime: 60_000,
  })
}
