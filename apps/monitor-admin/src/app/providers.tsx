import { MantineProvider } from '@mantine/core'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '@/app/queryClient'
import { monitorTheme } from '@/app/theme'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={monitorTheme} defaultColorScheme="light">
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MantineProvider>
  )
}
