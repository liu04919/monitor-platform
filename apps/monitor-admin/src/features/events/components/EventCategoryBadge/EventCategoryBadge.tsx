import { Badge } from '@mantine/core'
import type { EventCategory } from '@/features/events/model/eventTypes'
import styles from './EventCategoryBadge.module.css'

const categoryLabels: Record<EventCategory, string> = {
  error: '错误',
  performance: '性能',
  behavior: '行为',
  stability: '稳定性',
  ai: 'AI 性能',
}

const categoryColors: Record<EventCategory, string> = {
  error: 'red',
  performance: 'orange',
  behavior: 'blue',
  stability: 'violet',
  ai: 'teal',
}

export function EventCategoryBadge({ category }: { category: EventCategory }) {
  return (
    <Badge
      className={styles.badge}
      color={categoryColors[category]}
      variant="light"
      size="sm"
      radius="sm"
      leftSection={<span className={styles.dot} />}
    >
      {categoryLabels[category]}
    </Badge>
  )
}
