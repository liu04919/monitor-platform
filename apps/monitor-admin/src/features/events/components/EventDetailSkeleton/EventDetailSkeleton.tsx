import styles from './EventDetailSkeleton.module.css'

export function EventDetailSkeleton() {
  return <div className={styles.skeleton} aria-hidden="true"><span className={styles.title} /><div className={styles.summary}>{[0, 1, 2, 3].map((item) => <span key={item} />)}</div><div className={styles.code}><span /></div></div>
}
