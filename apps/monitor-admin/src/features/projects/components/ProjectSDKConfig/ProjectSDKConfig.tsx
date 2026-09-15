import { Button, CopyButton } from '@mantine/core'
import { buildSDKConfig } from '@/features/projects/model/buildSDKConfig'
import type { ProjectDetail } from '@/features/projects/model/projectTypes'
import { CopyIcon } from '@/shared/ui/icons/Icons'
import styles from './ProjectSDKConfig.module.css'

interface ProjectSDKConfigProps {
  project: ProjectDetail
}

export function ProjectSDKConfig({ project }: ProjectSDKConfigProps) {
  const sdkConfig = buildSDKConfig(project)

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <span>JavaScript</span>
        <CopyButton value={sdkConfig} timeout={1_600}>
          {({ copied, copy }) => (
            <Button variant="subtle" size="compact-sm" leftSection={<CopyIcon />} onClick={copy}>
              {copied ? '已复制' : '复制配置'}
            </Button>
          )}
        </CopyButton>
      </div>
      <pre className={styles.config} tabIndex={0} aria-label="SDK 初始化代码">
        <code translate="no">{sdkConfig}</code>
      </pre>
    </div>
  )
}
