import { Alert, Button, Skeleton, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { AlertIcon, EmptyIcon } from '@/shared/ui/icons/Icons'
import styles from './AsyncFeedback.module.css'

const loadingRows = Array.from({ length: 5 }, (_, index) => index)
const loadingCells = Array.from({ length: 6 }, (_, index) => index)

export function LoadingRows() {
  return (
    <>
      {loadingRows.map((row) => (
        <div className={styles.loadingRow} key={row} aria-hidden="true">
          {loadingCells.map((cell) => (
            <Skeleton
              className={cell === 0 ? styles.titleSkeleton : styles.skeleton}
              key={cell}
              radius="xl"
            />
          ))}
        </div>
      ))}
    </>
  )
}

export function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <Stack className={styles.emptyState} align="center" gap="xs">
      <ThemeIcon variant="light" color="gray" size={52} radius="md"><EmptyIcon /></ThemeIcon>
      <Title order={2}>{filtered ? '没有匹配的事件' : '还没有遥测事件'}</Title>
      <Text>{filtered ? '调整分类或事件类型后再试。' : '从 monitor-demo 触发场景后，事件会出现在这里。'}</Text>
    </Stack>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert
      className={styles.errorState}
      color="red"
      title="事件读取失败"
      icon={<AlertIcon />}
      role="alert"
    >
      <Text size="sm">{message}</Text>
      <Button variant="default" size="compact-sm" mt="sm" onClick={onRetry}>重新加载</Button>
    </Alert>
  )
}

export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert className={styles.inlineError} color="red" icon={<AlertIcon />} role="alert">
      <div className={styles.inlineContent}>
        <span>{message}</span>
        <Button variant="default" size="compact-xs" onClick={onRetry}>重试</Button>
      </div>
    </Alert>
  )
}
