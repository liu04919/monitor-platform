import { z } from 'zod'

const eventCategorySchema = z.enum(['error', 'performance', 'behavior', 'stability', 'ai'])

export const eventFilterSchema = z.object({
  category: z.union([z.literal(''), eventCategorySchema]),
  eventType: z.string().trim(),
})

export type EventFilterFormValues = z.infer<typeof eventFilterSchema>
