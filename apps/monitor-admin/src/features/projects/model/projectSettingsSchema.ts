import { z } from 'zod'
import { createProjectSchema } from '@/features/projects/model/createProjectSchema'

export const projectSettingsSchema = createProjectSchema.extend({
  enabled: z.boolean(),
})

export type ProjectSettingsFormValues = z.infer<typeof projectSettingsSchema>
