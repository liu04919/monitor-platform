import { Select } from '@mantine/core'
import type { ProjectSummary } from '@/features/projects/model/projectTypes'
import styles from './ProjectSwitcher.module.css'

interface ProjectSwitcherProps {
  projects: ProjectSummary[]
  projectId: string
  isLoading: boolean
  isError: boolean
  onChange: (projectId: string) => void
  onCreate: () => void
}

export function ProjectSwitcher({
  projects,
  projectId,
  isLoading,
  isError,
  onChange,
  onCreate,
}: ProjectSwitcherProps) {
  const selectedProject = projects.find((project) => project.id === projectId)
  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: `${project.name}${project.enabled ? '' : '（已停用）'}`,
  }))

  if (!selectedProject && projectId) {
    projectOptions.unshift({ value: projectId, label: projectId })
  }

  return (
    <div className={styles.switcher}>
      <Select
        label="当前项目"
        aria-label="当前项目"
        value={projectId || null}
        data={projectOptions}
        disabled={isLoading || projects.length === 0}
        allowDeselect={false}
        searchable={projects.length > 8}
        nothingFoundMessage="没有匹配的项目"
        onChange={(nextProjectId) => {
          if (nextProjectId) onChange(nextProjectId)
        }}
        classNames={{ label: styles.label, input: styles.input }}
      />
      <p className={styles.projectId} title={selectedProject?.id || projectId} translate="no">
        {isLoading ? '正在读取项目…' : isError ? '项目列表暂不可用' : selectedProject?.id || projectId}
      </p>
      <button
        type="button"
        className={styles.createButton}
        onClick={onCreate}
        disabled={isLoading}
      >
        新建项目
      </button>
    </div>
  )
}
