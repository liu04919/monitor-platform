import { useEffect } from 'react'
import { Alert, Badge, Button, CopyButton, Group, Paper, Skeleton, Text } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { updateProject } from '@/features/projects/api/projectsApi'
import { ProjectKeyRotation } from '@/features/projects/components/ProjectKeyRotation/ProjectKeyRotation'
import { ProjectSDKConfig } from '@/features/projects/components/ProjectSDKConfig/ProjectSDKConfig'
import { ProjectSettingsForm } from '@/features/projects/components/ProjectSettingsForm/ProjectSettingsForm'
import { projectErrorMessage } from '@/features/projects/model/projectError'
import {
  projectDetailQueryKey,
  projectDetailQueryOptions,
  projectsQueryKey,
} from '@/features/projects/model/projectQueries'
import type {
  ProjectDetail,
  ProjectListData,
  UpdateProjectInput,
} from '@/features/projects/model/projectTypes'
import { AlertIcon, CopyIcon } from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import styles from './ProjectSettingsPage.module.css'

export function ProjectSettingsPage() {
  const { projectId = '' } = useParams()
  const selectedProjectId = useAdminStore((state) => state.projectId)
  const setProjectId = useAdminStore((state) => state.setProjectId)
  const queryClient = useQueryClient()
  const query = useQuery(projectDetailQueryOptions(projectId))
  const updateMutation = useMutation({
    mutationFn: (input: UpdateProjectInput) => updateProject(projectId, input),
    onSuccess: (updatedProject) => {
      queryClient.setQueryData<ProjectDetail>(projectDetailQueryKey(updatedProject.id), updatedProject)
      queryClient.setQueryData<ProjectListData>(projectsQueryKey, (current) => current ? {
        projects: current.projects.map((project) => project.id === updatedProject.id
          ? {
              id: updatedProject.id,
              name: updatedProject.name,
              enabled: updatedProject.enabled,
              createdAt: updatedProject.createdAt,
            }
          : project),
      } : current)
    },
  })
  const detailProjectId = query.data?.id

  useEffect(() => {
    if (detailProjectId && selectedProjectId !== detailProjectId) setProjectId(detailProjectId)
  }, [detailProjectId, selectedProjectId, setProjectId])

  if (query.isPending) {
    return (
      <section className={styles.page} aria-label="正在读取项目设置">
        <Skeleton height={92} radius="md" />
        <Skeleton height={190} radius="md" mt="lg" />
        <Skeleton height={330} radius="md" mt="lg" />
      </section>
    )
  }

  if (query.isError) {
    return (
      <section className={styles.page}>
        <PageHeading />
        <Alert color="red" title="项目读取失败" icon={<AlertIcon />} role="alert">
          <Text size="sm">{projectErrorMessage(query.error)}</Text>
          <Button variant="default" size="compact-sm" mt="sm" onClick={() => void query.refetch()}>
            重新加载
          </Button>
        </Alert>
      </section>
    )
  }

  const project = query.data

  return (
    <section className={styles.page}>
      <PageHeading />
      <Paper className={styles.projectCard} withBorder radius="md">
        <Group className={styles.cardHeading} justify="space-between" align="flex-start">
          <div>
            <Text className={styles.label}>项目名称</Text>
            <h2>{project.name}</h2>
          </div>
          <Badge color={project.enabled ? 'green' : 'gray'} variant="light">
            {project.enabled ? '接入中' : '已停用'}
          </Badge>
        </Group>
        <div className={styles.metadata}>
          <div>
            <Text className={styles.label}>项目 ID / SDK appId</Text>
            <code>{project.id}</code>
          </div>
          <CopyButton value={project.id} timeout={1_600}>
            {({ copied, copy }) => (
              <Button variant="default" size="compact-sm" leftSection={<CopyIcon />} onClick={copy}>
                {copied ? '已复制' : '复制 ID'}
              </Button>
            )}
          </CopyButton>
          <div>
            <Text className={styles.label}>创建时间</Text>
            <Text size="sm">{new Date(project.createdAt).toLocaleString('zh-CN')}</Text>
          </div>
        </div>
      </Paper>
      <Paper className={styles.settingsCard} withBorder radius="md">
        <div className={styles.settingsHeading}>
          <Text className={styles.label}>常规设置</Text>
          <h2>名称与接入状态</h2>
          <p>停用项目只会阻止新事件上报，不会删除已有数据。</p>
        </div>
        <ProjectSettingsForm
          project={project}
          isPending={updateMutation.isPending}
          isSuccess={updateMutation.isSuccess}
          errorMessage={updateMutation.isError ? projectErrorMessage(updateMutation.error) : ''}
          onSubmit={(input) => updateMutation.mutate(input)}
        />
      </Paper>
      <Paper className={styles.sdkCard} withBorder radius="md">
        <div className={styles.sdkHeading}>
          <Text className={styles.label}>浏览器接入</Text>
          <h2>重新获取 SDK 初始化配置</h2>
          <p>配置来自当前项目详情，可以随时回来复制，不需要重新创建项目。</p>
        </div>
        <ProjectSDKConfig project={project} />
        <ProjectKeyRotation projectId={project.id} />
      </Paper>
    </section>
  )
}

function PageHeading() {
  return (
    <div className={styles.heading}>
      <p>PROJECT SETTINGS</p>
      <h1>项目设置</h1>
      <span>管理项目名称、SDK 接入状态与浏览器初始化配置。</span>
    </div>
  )
}
