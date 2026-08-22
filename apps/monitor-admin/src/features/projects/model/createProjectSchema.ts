import { z } from 'zod'

const maxProjectFieldLength = 128

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '请输入项目名称')
    .max(maxProjectFieldLength, '项目名称不能超过 128 个字符'),
})

export type CreateProjectFormValues = z.infer<typeof createProjectSchema>
