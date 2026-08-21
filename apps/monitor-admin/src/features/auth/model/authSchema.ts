import { z } from 'zod'

export const credentialsSchema = z.object({
  email: z.email('请输入有效的邮箱地址'),
  password: z.string().min(8, '密码至少需要 8 个字符').max(128, '密码最多 128 个字符'),
})

export const registerSchema = credentialsSchema.extend({
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, {
  message: '两次输入的密码不一致',
  path: ['confirmPassword'],
})

export type CredentialsInput = z.infer<typeof credentialsSchema>
export type RegisterInput = z.infer<typeof registerSchema>
