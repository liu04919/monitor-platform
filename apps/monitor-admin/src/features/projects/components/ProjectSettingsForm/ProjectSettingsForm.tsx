import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, Group, Stack, Switch, Text, TextInput } from '@mantine/core'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  projectSettingsSchema,
  type ProjectSettingsFormValues,
} from '@/features/projects/model/projectSettingsSchema'
import type { ProjectDetail, UpdateProjectInput } from '@/features/projects/model/projectTypes'
import styles from './ProjectSettingsForm.module.css'

interface ProjectSettingsFormProps {
  project: ProjectDetail
  isPending: boolean
  isSuccess: boolean
  errorMessage: string
  onSubmit: (input: UpdateProjectInput) => void
}

export function ProjectSettingsForm({
  project,
  isPending,
  isSuccess,
  errorMessage,
  onSubmit,
}: ProjectSettingsFormProps) {
  const form = useForm<ProjectSettingsFormValues>({
    resolver: zodResolver(projectSettingsSchema),
    defaultValues: { name: project.name, enabled: project.enabled },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  })
  const { reset } = form
  const enabled = useWatch({ control: form.control, name: 'enabled' })

  useEffect(() => {
    reset({ name: project.name, enabled: project.enabled })
  }, [project.enabled, project.name, reset])

  return (
    <form
      className={styles.form}
      onSubmit={form.handleSubmit((values) => onSubmit(values))}
      noValidate
    >
      <Stack gap="lg">
        <TextInput
          label="项目名称"
          description="修改名称不会改变项目 ID。"
          autoComplete="off"
          maxLength={128}
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <Controller
          name="enabled"
          control={form.control}
          render={({ field }) => (
            <Switch
              label="允许 SDK 上报"
              description="关闭后停止接收新事件。"
              checked={field.value}
              onChange={(event) => field.onChange(event.currentTarget.checked)}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          )}
        />
        {!enabled ? (
          <Alert color="yellow" title="项目将停止接收新事件" role="status">
            已有事件不受影响。
          </Alert>
        ) : null}
        {errorMessage ? (
          <Alert color="red" title="保存失败" role="alert">
            {errorMessage}
          </Alert>
        ) : null}
        <Group className={styles.actions} justify="space-between" align="center">
          <Text size="sm" c="green" aria-live="polite">
            {isSuccess && !form.formState.isDirty ? '设置已保存' : ''}
          </Text>
          <Button type="submit" loading={isPending} disabled={!form.formState.isDirty}>
            保存设置
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
