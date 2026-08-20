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

export function ProjectSwitcher({ projects, projectId, isLoading, isError, onChange, onCreate }: ProjectSwitcherProps) {
  const selectedProject = projects.find((project) => project.id === projectId)

  return (
    <div className={styles.switcher}>
      <label htmlFor="project-switcher">当前项目</label>
      <select
        id="project-switcher"
        value={projectId}
        disabled={isLoading || projects.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {!selectedProject && projectId ? <option value={projectId}>{projectId}</option> : null}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}{project.enabled ? '' : '（已停用）'}
          </option>
        ))}
      </select>
      <small>{isLoading ? '正在读取项目…' : isError ? '项目列表暂不可用' : selectedProject?.id || projectId}</small>
      <button type="button" onClick={onCreate} disabled={isLoading}>新建项目</button>
    </div>
  )
}
