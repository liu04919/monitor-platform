export interface ProjectSummary {
  id: string
  name: string
  enabled: boolean
  createdAt: number
}

export interface ProjectListData {
  projects: ProjectSummary[]
}

export interface CreateProjectInput {
  name: string
}

export interface UpdateProjectInput {
  name?: string
  enabled?: boolean
}

export interface ProjectDetail extends ProjectSummary {
  publicKey: string
}

export type CreatedProject = ProjectDetail
