import { Alert, Button, Center, Loader, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { currentUserQueryOptions } from '@/features/auth/model/authQueries'
import { authErrorMessage } from '@/features/auth/model/authError'
import { APIError } from '@/shared/api/apiClient'

export function AuthGuard() {
  const location = useLocation()
  const query = useQuery(currentUserQueryOptions())

  if (query.isPending) {
    return <Center mih="100vh"><Loader aria-label="正在验证登录状态" /></Center>
  }

  if (query.isError) {
    if (query.error instanceof APIError && query.error.status === 401) {
      const from = `${location.pathname}${location.search}${location.hash}`
      return <Navigate to="/login" replace state={{ from }} />
    }

    return (
      <Center mih="100vh" p="md">
        <Alert color="red" title="暂时无法验证登录状态" role="alert" maw={440}>
          <Stack gap="sm">
            <Text size="sm">{authErrorMessage(query.error)}</Text>
            <Button variant="default" onClick={() => void query.refetch()}>重新尝试</Button>
          </Stack>
        </Alert>
      </Center>
    )
  }

  return <Outlet />
}
