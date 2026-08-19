export interface ProjectSummary {
  id: string
  name: string
  enabled: boolean
  createdAt: number
}

export interface ProjectListData {
  projects: ProjectSummary[]
}
