import { create } from 'zustand'
import { runtimeConfig } from '@/shared/config/runtime'

interface AdminState {
  projectId: string
  setProjectId: (projectId: string) => void
}

export const useAdminStore = create<AdminState>((set) => ({
  projectId: runtimeConfig.projectId,
  setProjectId: (projectId) => set({ projectId }),
}))
