import { z } from 'zod'

const maxProjectFieldLength = 128
const projectIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '请输入项目名称')
    .max(maxProjectFieldLength, '项目名称不能超过 128 个字符'),
  id: z
    .string()
    .trim()
    .min(1, '请输入项目 ID')
    .max(maxProjectFieldLength, '项目 ID 不能超过 128 个字符')
    .regex(projectIdPattern, '只能使用小写字母、数字和中间连字符'),
})

export type CreateProjectFormValues = z.infer<typeof createProjectSchema>
