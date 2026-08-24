import { useEffect } from 'react'
import { Alert, Badge, Button, CopyButton, Paper, Skeleton, Text } from '@mantine/core'
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

const projectDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

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
      <Paper
        component="section"
        className={styles.projectCard}
        withBorder
        radius="md"
        aria-labelledby="project-summary-title"
      >
        <div className={styles.summaryHeading}>
          <h2 id="project-summary-title">{project.name}</h2>
          <Badge color={project.enabled ? 'green' : 'gray'} variant="light">
            {project.enabled ? '接入中' : '已停用'}
          </Badge>
        </div>
        <dl className={styles.metadata}>
          <div>
            <dt>项目 ID（SDK appId）</dt>
            <dd className={styles.projectId}>
              <code translate="no">{project.id}</code>
              <CopyButton value={project.id} timeout={1_600}>
                {({ copied, copy }) => (
                  <Button
                    variant="default"
                    size="compact-sm"
                    leftSection={<CopyIcon />}
                    onClick={copy}
                  >
                    {copied ? '已复制' : '复制 ID'}
                  </Button>
                )}
              </CopyButton>
            </dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>
              <time dateTime={new Date(project.createdAt).toISOString()}>
                {projectDateFormatter.format(project.createdAt)}
              </time>
            </dd>
          </div>
        </dl>
      </Paper>
      <Paper
        component="section"
        className={styles.settingsCard}
        withBorder
        radius="md"
        aria-labelledby="general-settings-title"
      >
        <div className={styles.settingsLayout}>
          <h2 id="general-settings-title" className={styles.sectionTitle}>
            常规设置
          </h2>
          <ProjectSettingsForm
            project={project}
            isPending={updateMutation.isPending}
            isSuccess={updateMutation.isSuccess}
            errorMessage={updateMutation.isError ? projectErrorMessage(updateMutation.error) : ''}
            onSubmit={(input) => updateMutation.mutate(input)}
          />
        </div>
      </Paper>
      <Paper
        component="section"
        className={styles.sdkCard}
        withBorder
        radius="md"
        aria-labelledby="sdk-config-title"
      >
        <h2 id="sdk-config-title" className={styles.sectionTitle}>
          SDK 初始化配置
        </h2>
        <ProjectSDKConfig project={project} />
      </Paper>
      <Paper
        component="section"
        className={styles.dangerCard}
        withBorder
        radius="md"
        aria-labelledby="danger-zone-title"
      >
        <h2 id="danger-zone-title" className={styles.dangerTitle}>
          危险操作
        </h2>
        <ProjectKeyRotation projectId={project.id} />
      </Paper>
    </section>
  )
}

function PageHeading() {
  return (
    <div className={styles.heading}>
      <h1>项目设置</h1>
    </div>
  )
}
