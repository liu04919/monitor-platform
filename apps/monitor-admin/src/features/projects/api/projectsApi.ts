import { getJSON, postJSON } from '@/shared/api/apiClient'
import type { CreateProjectInput, CreatedProject, ProjectListData } from '@/features/projects/model/projectTypes'

export function listProjects(signal?: AbortSignal) {
  return getJSON<ProjectListData>('/projects', signal)
}

export function createProject(input: CreateProjectInput) {
  return postJSON<CreatedProject>('/projects', input)
}
