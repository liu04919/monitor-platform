import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Group, Select, TextInput } from '@mantine/core'
import { Controller, useForm } from 'react-hook-form'
import {
  eventFilterSchema,
  type EventFilterFormValues,
} from '@/features/events/model/eventFilterSchema'
import type { EventFilters as Filters } from '@/features/events/model/eventTypes'
import styles from './EventFilters.module.css'

const categoryOptions = [
  { value: 'error', label: '错误' },
  { value: 'performance', label: '性能' },
  { value: 'behavior', label: '行为' },
  { value: 'stability', label: '稳定性' },
  { value: 'ai', label: 'AI 性能' },
]

interface EventFiltersProps {
  value: Filters
  onApply: (filters: Filters) => void
}

export function EventFilters({ value, onApply }: EventFiltersProps) {
  const form = useForm<EventFilterFormValues>({
    resolver: zodResolver(eventFilterSchema),
    defaultValues: value,
  })
  const hasFilters = Boolean(value.category || value.eventType)

  return (
    <form className={styles.filterBar} onSubmit={form.handleSubmit(onApply)} noValidate>
      <Controller
        control={form.control}
        name="category"
        render={({ field }) => (
          <Select
            className={styles.categoryFilter}
            label="事件分类"
            placeholder="全部分类"
            data={categoryOptions}
            value={field.value || null}
            onChange={(nextValue) => field.onChange(nextValue || '')}
            clearable
            allowDeselect
          />
        )}
      />
      <TextInput
        className={styles.eventTypeFilter}
        label="事件类型"
        placeholder="例如 js_error"
        {...form.register('eventType')}
      />
      <Group className={styles.actions} gap="xs">
        <Button type="submit" color="dark">应用筛选</Button>
        {hasFilters ? (
          <Button
            variant="subtle"
            color="gray"
            type="button"
            onClick={() => onApply({ category: '', eventType: '' })}
          >
            清除
          </Button>
        ) : null}
      </Group>
    </form>
  )
}
