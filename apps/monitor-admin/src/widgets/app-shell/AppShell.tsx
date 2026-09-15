import { useEffect, useMemo, useState } from 'react'
import { Button } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom'
import { logout } from '@/features/auth/api/authApi'
import { currentUserQueryOptions } from '@/features/auth/model/authQueries'
import { authErrorMessage } from '@/features/auth/model/authError'
import { createProject } from '@/features/projects/api/projectsApi'
import { CreateProjectDialog } from '@/features/projects/components/CreateProjectDialog/CreateProjectDialog'
import { ProjectSwitcher } from '@/features/projects/components/ProjectSwitcher/ProjectSwitcher'
import { projectsQueryKey, projectsQueryOptions } from '@/features/projects/model/projectQueries'
import type { CreatedProject, ProjectListData } from '@/features/projects/model/projectTypes'
import {
  AlertIcon,
  ChevronIcon,
  EventsIcon,
  PulseIcon,
  SettingsIcon,
} from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import styles from './AppShell.module.css'

export function AppShell() {
  const projectId = useAdminStore((state) => state.projectId)
  const setProjectId = useAdminStore((state) => state.setProjectId)
  const clearProjectId = useAdminStore((state) => state.clearProjectId)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createdProject, setCreatedProject] = useState<CreatedProject | null>(null)
  const queryClient = useQueryClient()
  const currentUserQuery = useQuery(currentUserQueryOptions())
  const projectsQuery = useQuery(projectsQueryOptions())
  const projects = useMemo(() => projectsQuery.data?.projects || [], [projectsQuery.data?.projects])
  const selectedProject = projects.find((project) => project.id === projectId)
  const issuesMatch = useMatch('/issues')
  const issueDetailMatch = useMatch('/issues/:issueId')
  const eventsMatch = useMatch('/events')
  const detailMatch = useMatch('/events/:eventId')
  const settingsMatch = useMatch('/projects/:projectId/settings')
  const navigate = useNavigate()
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      queryClient.setQueryData<ProjectListData>(projectsQueryKey, (current) => ({
        projects: [
          ...(current?.projects.filter((item) => item.id !== project.id) || []),
          {
            id: project.id,
            name: project.name,
            enabled: project.enabled,
            createdAt: project.createdAt,
          },
        ],
      }))
      setCreatedProject(project)
      setProjectId(project.id)
      navigate('/issues')
    },
  })
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      clearProjectId()
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  useEffect(() => {
    if (!projectsQuery.isSuccess) return
    if (projects.length === 0) {
      if (projectId) clearProjectId()
      return
    }
    if (!selectedProject) setProjectId(projects[0].id)
  }, [clearProjectId, projectId, projects, projectsQuery.isSuccess, selectedProject, setProjectId])

  const switchProject = (nextProjectId: string) => {
    if (nextProjectId === projectId) return
    setProjectId(nextProjectId)
    navigate(eventsMatch || detailMatch ? '/events' : '/issues')
  }

  const openCreateDialog = () => {
    createMutation.reset()
    setCreatedProject(null)
    setCreateDialogOpen(true)
  }

  const closeCreateDialog = () => {
    createMutation.reset()
    setCreateDialogOpen(false)
  }

  const hasNoProjects = projectsQuery.isSuccess && projects.length === 0
  const submitLogout = () => logoutMutation.mutate()

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        跳到主要内容
      </a>
      <aside className={styles.sidebar}>
        <div className={styles.brandLockup}>
          <span className={styles.brandMark}>
            <PulseIcon />
          </span>
          <span>
            <strong>Monitor</strong>
            <small>Admin</small>
          </span>
        </div>
        <ProjectSwitcher
          projects={projects}
          projectId={projectId}
          isLoading={projectsQuery.isPending}
          isError={projectsQuery.isError}
          onChange={switchProject}
          onCreate={openCreateDialog}
        />
        <nav aria-label="管理端导航">
          <NavLink
            to="/issues"
            className={({ isActive }) => (isActive ? styles.active : undefined)}
          >
            <AlertIcon />
            <span>问题</span>
          </NavLink>
          <NavLink
            to="/events"
            className={({ isActive }) => (isActive ? styles.active : undefined)}
          >
            <EventsIcon />
            <span>事件流</span>
          </NavLink>
          {projectId ? (
            <NavLink
              to={`/projects/${projectId}/settings`}
              className={({ isActive }) => (isActive ? styles.active : undefined)}
            >
              <SettingsIcon />
              <span>项目设置</span>
            </NavLink>
          ) : null}
        </nav>
        <div className={styles.sidebarFoot}>
          <span className={styles.accountMark} aria-hidden="true">
            {currentUserQuery.data?.email.slice(0, 1)}
          </span>
          <span className={styles.account}>
            <strong title={currentUserQuery.data?.email}>{currentUserQuery.data?.email}</strong>
            <Button
              variant="subtle"
              color="gray"
              size="compact-xs"
              loading={logoutMutation.isPending}
              onClick={submitLogout}
            >
              退出登录
            </Button>
            {logoutMutation.isError ? (
              <small role="alert">{authErrorMessage(logoutMutation.error)}</small>
            ) : null}
          </span>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <nav aria-label="面包屑">
            {issuesMatch ? <span>问题</span> : null}
            {issueDetailMatch ? (
              <>
                <NavLink to="/issues">问题</NavLink>
                <ChevronIcon />
                <span>问题详情</span>
              </>
            ) : null}
            {eventsMatch ? <span>事件流</span> : null}
            {detailMatch ? (
              <>
                <NavLink to="/events">事件流</NavLink>
                <ChevronIcon />
                <span>事件详情</span>
              </>
            ) : null}
            {settingsMatch ? (
              <>
                <NavLink to="/issues">问题</NavLink>
                <ChevronIcon />
                <span>项目设置</span>
              </>
            ) : null}
          </nav>
          <div className={styles.projectChip} title={projectId}>
            {selectedProject?.name || '未选择项目'}
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {hasNoProjects ? (
            <section className={styles.firstProject} aria-labelledby="first-project-title">
              <EventsIcon />
              <h1 id="first-project-title">创建你的第一个项目</h1>
              <Button className={styles.firstProjectButton} onClick={openCreateDialog}>
                创建第一个项目
              </Button>
            </section>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      {createDialogOpen ? (
        <CreateProjectDialog
          isPending={createMutation.isPending}
          errorMessage={createMutation.error instanceof Error ? createMutation.error.message : ''}
          createdProject={createdProject}
          onSubmit={(input) => createMutation.mutate(input)}
          onClose={closeCreateDialog}
        />
      ) : null}
    </div>
  )
}
