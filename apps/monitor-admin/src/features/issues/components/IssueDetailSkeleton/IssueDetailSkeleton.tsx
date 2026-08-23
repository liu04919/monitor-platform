import { Skeleton } from '@mantine/core'
import styles from './IssueDetailSkeleton.module.css'

export function IssueDetailSkeleton() {
  return (
    <div className={styles.root} aria-label="正在读取问题详情">
      <Skeleton width={112} height={26} />
      <div className={styles.heading}>
        <Skeleton circle height={44} />
        <div>
          <Skeleton width={180} height={18} />
          <Skeleton width="min(680px, 70vw)" height={34} mt={12} />
        </div>
      </div>
      <Skeleton height={214} radius={12} />
      <Skeleton height={310} radius={12} />
    </div>
  )
}
