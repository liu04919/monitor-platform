import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, PasswordInput, Stack, TextInput } from '@mantine/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { login, register } from '@/features/auth/api/authApi'
import { AuthLayout } from '@/features/auth/components/AuthLayout/AuthLayout'
import { currentUserQueryKey } from '@/features/auth/model/authQueries'
import { authErrorMessage } from '@/features/auth/model/authError'
import { registerSchema, type RegisterInput } from '@/features/auth/model/authSchema'
import type { AuthUser } from '@/features/auth/model/authTypes'

class AccountCreatedLoginError extends Error {
  constructor() {
    super('账号已经创建，但登录服务暂时不可用。请前往登录页稍后重试。')
  }
}

export function RegisterPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  })
  const mutation = useMutation({
    mutationFn: async ({ email, password }: RegisterInput) => {
      await register({ email, password })
      try {
        return await login({ email, password })
      } catch {
        throw new AccountCreatedLoginError()
      }
    },
    onSuccess: (user) => {
      queryClient.setQueryData<AuthUser>(currentUserQueryKey, user)
      navigate('/issues', { replace: true })
    },
  })

  return (
    <AuthLayout
      title="创建账号"
      description="账号创建成功后会自动登录，然后你可以创建第一个监控项目。"
      footer={<>已经有账号？ <Link to="/login">返回登录</Link></>}
    >
      <form onSubmit={form.handleSubmit((value) => mutation.mutate(value))} noValidate>
        <Stack gap="md">
          {mutation.isError ? <Alert color="red" role="alert">{authErrorMessage(mutation.error)}</Alert> : null}
          <Controller name="email" control={form.control} render={({ field, fieldState }) => (
            <TextInput {...field} label="邮箱" type="email" autoComplete="email" error={fieldState.error?.message} />
          )} />
          <Controller name="password" control={form.control} render={({ field, fieldState }) => (
            <PasswordInput {...field} label="密码" autoComplete="new-password" error={fieldState.error?.message} />
          )} />
          <Controller name="confirmPassword" control={form.control} render={({ field, fieldState }) => (
            <PasswordInput {...field} label="确认密码" autoComplete="new-password" error={fieldState.error?.message} />
          )} />
          <Button type="submit" loading={mutation.isPending}>注册并登录</Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}
