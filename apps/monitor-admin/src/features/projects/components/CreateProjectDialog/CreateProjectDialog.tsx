import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, CopyButton, Group, Modal, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from 'react-hook-form'
import {
  createProjectSchema,
  type CreateProjectFormValues,
} from '@/features/projects/model/createProjectSchema'
import type { CreateProjectInput, CreatedProject } from '@/features/projects/model/projectTypes'
import styles from './CreateProjectDialog.module.css'

interface CreateProjectDialogProps {
  isPending: boolean
  errorMessage: string
  createdProject: CreatedProject | null
  onSubmit: (input: CreateProjectInput) => void
  onClose: () => void
}

export function CreateProjectDialog({
  isPending,
  errorMessage,
  createdProject,
  onSubmit,
  onClose,
}: CreateProjectDialogProps) {
  const form = useForm<CreateProjectFormValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { id: '', name: '' },
    mode: 'onBlur',
  })
  const sdkConfig = createdProject ? buildSDKConfig(createdProject) : ''
  const submit = form.handleSubmit((values) => onSubmit(values))

  return (
    <Modal
      opened
      onClose={isPending ? () => undefined : onClose}
      closeOnClickOutside={!isPending}
      closeOnEscape={!isPending}
      withCloseButton={!isPending}
      centered
      size="560px"
      radius="lg"
      padding="xl"
      overlayProps={{ backgroundOpacity: 0.58, blur: 4 }}
      classNames={{ content: styles.dialog, header: styles.header, body: styles.body }}
      title={(
        <div>
          <Text className={styles.eyebrow}>{createdProject ? 'PROJECT READY' : 'NEW PROJECT'}</Text>
          <Title order={2}>{createdProject ? '项目已创建' : '创建项目'}</Title>
        </div>
      )}
    >
      {createdProject ? (
        <Stack gap="md">
          <Text className={styles.description}>
            项目已自动切换。把下面配置放进浏览器 SDK 初始化代码即可开始上报。
          </Text>
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
          <Text className={styles.boundary}>
            publicKey 会出现在浏览器中，只能用于事件上报，不能读取管理数据。
          </Text>
          <Button onClick={onClose}>完成</Button>
        </Stack>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <Text className={styles.description}>项目 ID 会成为 SDK 的 appId，创建后不可修改。</Text>
          <TextInput
            label="项目名称"
            placeholder="例如 Monitor Web"
            autoFocus
            maxLength={128}
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <TextInput
            label="项目 ID"
            description="仅小写字母、数字和中间连字符。"
            placeholder="例如 monitor-web"
            maxLength={128}
            error={form.formState.errors.id?.message}
            {...form.register('id')}
          />
          {errorMessage ? (
            <Alert color="red" title="创建失败" role="alert">
              {errorMessage}
            </Alert>
          ) : null}
          <Group justify="flex-end" mt="xs">
            <Button variant="default" type="button" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" loading={isPending}>
              创建项目
            </Button>
          </Group>
        </form>
      )}
    </Modal>
  )
}

function buildSDKConfig(project: CreatedProject) {
  return `createMonitor({
  url: 'http://127.0.0.1:8080/api/v1/events/batch',
  projectName: '${escapeJavaScriptString(project.name)}',
  appId: '${escapeJavaScriptString(project.id)}',
  publicKey: '${escapeJavaScriptString(project.publicKey)}',
})`
}

function escapeJavaScriptString(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}
