import { getJSON } from '@/shared/api/apiClient'
import type { ProjectListData } from '@/features/projects/model/projectTypes'

export function listProjects(signal?: AbortSignal) {
  return getJSON<ProjectListData>('/projects', signal)
}
