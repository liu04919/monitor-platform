import { useState, type FormEvent } from 'react'
import type { EventCategory, EventFilters as Filters } from '@/features/events/model/eventTypes'
import styles from './EventFilters.module.css'

interface EventFiltersProps {
  value: Filters
  onApply: (filters: Filters) => void
}

export function EventFilters({ value, onApply }: EventFiltersProps) {
  const [draft, setDraft] = useState(value)
  const hasFilters = Boolean(value.category || value.eventType)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onApply({ category: draft.category, eventType: draft.eventType.trim() })
  }

  return (
    <form className={styles.filterBar} onSubmit={submit}>
      <label>
        <span>事件分类</span>
        <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as EventCategory | '' }))}>
          <option value="">全部分类</option>
          <option value="error">错误</option>
          <option value="performance">性能</option>
          <option value="behavior">行为</option>
          <option value="stability">稳定性</option>
          <option value="ai">AI 性能</option>
        </select>
      </label>
      <label className={styles.eventTypeFilter}>
        <span>事件类型</span>
        <input value={draft.eventType} onChange={(event) => setDraft((current) => ({ ...current, eventType: event.target.value }))} placeholder="例如 js_error" />
      </label>
      <button className={styles.primaryButton} type="submit">应用筛选</button>
      {hasFilters ? <button className={styles.textButton} type="button" onClick={() => onApply({ category: '', eventType: '' })}>清除</button> : null}
    </form>
  )
}
