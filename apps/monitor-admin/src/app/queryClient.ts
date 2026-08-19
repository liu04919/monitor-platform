import { QueryClient } from '@tanstack/react-query'

export function createAdminQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}

export const queryClient = createAdminQueryClient()
