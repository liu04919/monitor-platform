import { Skeleton } from '@mantine/core'
import styles from './EventDetailSkeleton.module.css'

export function EventDetailSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <Skeleton className={styles.title} radius="xl" />
      <div className={styles.summary}>{[0, 1, 2, 3].map((item) => <Skeleton key={item} radius="xl" />)}</div>
      <div className={styles.code}><Skeleton radius="md" /></div>
    </div>
  )
}
