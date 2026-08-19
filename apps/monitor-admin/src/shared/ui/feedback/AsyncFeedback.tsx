import { AlertIcon, EmptyIcon } from '@/shared/ui/icons/Icons'
import styles from './AsyncFeedback.module.css'

export function LoadingRows() {
  return <>{[0, 1, 2, 3, 4].map((row) => <div className={styles.loadingRow} key={row} aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((cell) => <span className={cell === 0 ? styles.titleSkeleton : styles.skeleton} key={cell} />)}</div>)}</>
}

export function EmptyState({ filtered }: { filtered: boolean }) {
  return <div className={styles.emptyState}><span><EmptyIcon /></span><h2>{filtered ? '没有匹配的事件' : '还没有遥测事件'}</h2><p>{filtered ? '调整分类或事件类型后再试。' : '从 monitor-demo 触发场景后，事件会出现在这里。'}</p></div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className={styles.errorState} role="alert"><span><AlertIcon /></span><div><h2>事件读取失败</h2><p>{message}</p></div><button type="button" onClick={onRetry}>重新加载</button></div>
}

export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className={styles.inlineError} role="alert"><AlertIcon />{message}<button type="button" onClick={onRetry}>重试</button></div>
}
