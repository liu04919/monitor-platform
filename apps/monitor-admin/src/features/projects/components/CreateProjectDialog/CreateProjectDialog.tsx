import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
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
    mode: 'onSubmit',
    reValidateMode: 'onChange',
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
      size="520px"
      radius="md"
      padding="xl"
      classNames={{
        content: styles.dialog,
        header: styles.header,
        title: styles.title,
        body: styles.body,
      }}
      title={createdProject ? '项目已创建' : '创建项目'}
    >
      {createdProject ? (
        <Stack gap="md">
          <Text className={styles.description}>复制以下配置并用于 SDK 初始化。</Text>
          <ProjectSDKConfig project={createdProject} />
          <Button onClick={onClose}>完成</Button>
        </Stack>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <TextInput
            label="项目名称"
            placeholder="例如 Monitor Web"
            autoFocus
            maxLength={128}
            autoComplete="off"
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
