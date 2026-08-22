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

export interface CreatedProject extends ProjectSummary {
  publicKey: string
}
