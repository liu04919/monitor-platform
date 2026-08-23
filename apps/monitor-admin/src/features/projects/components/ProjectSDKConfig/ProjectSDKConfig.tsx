import { Button, CopyButton, Group, Stack, Text } from '@mantine/core'
import { buildSDKConfig } from '@/features/projects/model/buildSDKConfig'
import type { ProjectDetail } from '@/features/projects/model/projectTypes'
import styles from './ProjectSDKConfig.module.css'

interface ProjectSDKConfigProps {
  project: ProjectDetail
}

export function ProjectSDKConfig({ project }: ProjectSDKConfigProps) {
  const sdkConfig = buildSDKConfig(project)

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={700} size="sm">SDK 配置</Text>
        <CopyButton value={sdkConfig} timeout={1_600}>
          {({ copied, copy }) => (
            <Button variant="default" size="compact-sm" onClick={copy}>
              {copied ? '已复制' : '复制配置'}
            </Button>
          )}
        </CopyButton>
      </Group>
      <pre className={styles.config}><code>{sdkConfig}</code></pre>
    </Stack>
  )
}
