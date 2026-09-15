import { Alert, Button, Text } from '@mantine/core'

export function ReplayError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert color="red" title="录屏无法播放" role="alert">
      <Text size="sm">{message}</Text>
      <Button variant="default" size="xs" mt="sm" onClick={onRetry}>
        重新加载录屏
      </Button>
    </Alert>
  )
}
