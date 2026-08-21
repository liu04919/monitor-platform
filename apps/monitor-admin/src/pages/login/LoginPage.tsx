import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, PasswordInput, Stack, TextInput } from '@mantine/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { login } from '@/features/auth/api/authApi'
import { AuthLayout } from '@/features/auth/components/AuthLayout/AuthLayout'
import { currentUserQueryKey } from '@/features/auth/model/authQueries'
import { authErrorMessage } from '@/features/auth/model/authError'
import { credentialsSchema, type CredentialsInput } from '@/features/auth/model/authSchema'
import type { AuthUser } from '@/features/auth/model/authTypes'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const form = useForm<CredentialsInput>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  })
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData<AuthUser>(currentUserQueryKey, user)
      const from = (location.state as { from?: string } | null)?.from || '/events'
      navigate(from, { replace: true })
    },
  })

  return (
    <AuthLayout
      title="登录管理端"
      description="使用账号访问自己的项目和遥测事件。"
      footer={<>还没有账号？ <Link to="/register">创建账号</Link></>}
    >
      <form onSubmit={form.handleSubmit((value) => mutation.mutate(value))} noValidate>
        <Stack gap="md">
          {mutation.isError ? <Alert color="red" role="alert">{authErrorMessage(mutation.error)}</Alert> : null}
          <Controller name="email" control={form.control} render={({ field, fieldState }) => (
            <TextInput {...field} label="邮箱" type="email" autoComplete="email" error={fieldState.error?.message} />
          )} />
          <Controller name="password" control={form.control} render={({ field, fieldState }) => (
            <PasswordInput {...field} label="密码" autoComplete="current-password" error={fieldState.error?.message} />
          )} />
          <Button type="submit" loading={mutation.isPending}>登录</Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}
