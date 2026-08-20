import { Button, CopyButton, Paper, Title } from '@mantine/core'
import { CheckIcon, CopyIcon } from '@/shared/ui/icons/Icons'
import styles from './JsonPanel.module.css'

export function JsonPanel({ title, value }: { title: string; value: unknown }) {
  const formatted = JSON.stringify(value, null, 2)
  return (
    <Paper component="section" className={styles.card} radius="md">
      <header>
        <Title order={2}>{title}</Title>
        <CopyButton value={formatted} timeout={1_600}>
          {({ copied, copy }) => (
            <Button
              variant="default"
              size="compact-xs"
              onClick={copy}
              leftSection={copied ? <CheckIcon /> : <CopyIcon />}
            >
              {copied ? '已复制' : '复制'}
            </Button>
          )}
        </CopyButton>
      </header>
      <pre><code>{formatted}</code></pre>
    </Paper>
  )
}
