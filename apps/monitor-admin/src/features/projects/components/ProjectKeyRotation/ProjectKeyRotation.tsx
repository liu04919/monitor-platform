import { useState } from 'react'
import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { rotateProjectPublicKey } from '@/features/projects/api/projectsApi'
import { projectErrorMessage } from '@/features/projects/model/projectError'
import { projectDetailQueryKey } from '@/features/projects/model/projectQueries'
import type { ProjectDetail } from '@/features/projects/model/projectTypes'
import styles from './ProjectKeyRotation.module.css'

interface ProjectKeyRotationProps {
  projectId: string
}

export function ProjectKeyRotation({ projectId }: ProjectKeyRotationProps) {
  const [opened, setOpened] = useState(false)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => rotateProjectPublicKey(projectId),
    onSuccess: (updatedProject) => {
      queryClient.setQueryData<ProjectDetail>(projectDetailQueryKey(updatedProject.id), updatedProject)
      setOpened(false)
    },
  })

  const openConfirmation = () => {
    mutation.reset()
    setOpened(true)
  }

  return (
    <div className={styles.rotation}>
      <div className={styles.description}>
        <Text fw={700}>重新生成 publicKey</Text>
        <Text size="sm" c="dimmed">
          仅在当前 key 泄露或需要主动失效时使用。项目和历史事件不会受到影响。
        </Text>
      </div>
      <Button color="red" variant="light" onClick={openConfirmation}>
        重新生成 publicKey
      </Button>
      {mutation.isSuccess ? (
        <Alert className={styles.feedback} color="green" title="新的 publicKey 已生成" role="status">
          SDK 初始化配置已更新，旧 publicKey 现在无法继续上报。
        </Alert>
      ) : null}
      <Modal
        opened={opened}
        onClose={mutation.isPending ? () => undefined : () => setOpened(false)}
        closeOnClickOutside={!mutation.isPending}
        closeOnEscape={!mutation.isPending}
        withCloseButton={!mutation.isPending}
        centered
        title="确认重新生成 publicKey"
      >
        <Stack gap="md">
          <Alert color="red" title="旧 publicKey 会立即失效">
            轮换后必须把新的 publicKey 更新到浏览器 SDK 配置，否则线上页面将无法继续上报事件。
          </Alert>
          {mutation.isError ? (
            <Alert color="red" title="重新生成失败" role="alert">
              {projectErrorMessage(mutation.error)}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <Button color="red" loading={mutation.isPending} onClick={() => mutation.mutate()}>
              确认重新生成
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}
