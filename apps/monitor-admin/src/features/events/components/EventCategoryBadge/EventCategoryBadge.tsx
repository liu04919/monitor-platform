import type { EventCategory } from '@/features/events/model/eventTypes'
import styles from './EventCategoryBadge.module.css'

const categoryLabels: Record<EventCategory, string> = {
  error: '错误',
  performance: '性能',
  behavior: '行为',
  stability: '稳定性',
  ai: 'AI 性能',
}

export function EventCategoryBadge({ category }: { category: EventCategory }) {
  return <span className={`${styles.badge} ${styles[category]}`}><i />{categoryLabels[category]}</span>
}
