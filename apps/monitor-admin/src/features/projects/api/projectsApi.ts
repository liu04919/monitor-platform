import { getJSON, patchJSON, postJSON } from '@/shared/api/apiClient'
import type {
  CreateProjectInput,
  CreatedProject,
  ProjectDetail,
  ProjectListData,
  UpdateProjectInput,
} from '@/features/projects/model/projectTypes'

export function listProjects(signal?: AbortSignal) {
  return getJSON<ProjectListData>('/projects', signal)
}

export function getProject(projectId: string, signal?: AbortSignal) {
  return getJSON<ProjectDetail>(`/projects/${encodeURIComponent(projectId)}`, signal)
}

export function createProject(input: CreateProjectInput) {
  return postJSON<CreatedProject>('/projects', input)
}

export function updateProject(projectId: string, input: UpdateProjectInput) {
  return patchJSON<ProjectDetail>(`/projects/${encodeURIComponent(projectId)}`, input)
}
