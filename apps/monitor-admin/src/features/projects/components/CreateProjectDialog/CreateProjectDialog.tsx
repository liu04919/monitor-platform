import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, Group, Modal, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from 'react-hook-form'
import { ProjectSDKConfig } from '@/features/projects/components/ProjectSDKConfig/ProjectSDKConfig'
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
    defaultValues: { name: '' },
    mode: 'onBlur',
  })
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
          <ProjectSDKConfig project={createdProject} />
          <Button onClick={onClose}>完成</Button>
        </Stack>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <Text className={styles.description}>只需要填写名称，项目 ID 和 SDK publicKey 由服务端安全生成。</Text>
          <TextInput
            label="项目名称"
            placeholder="例如 Monitor Web"
            autoFocus
            maxLength={128}
            error={form.formState.errors.name?.message}
            {...form.register('name')}
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
