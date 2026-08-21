import { create } from 'zustand'

interface AdminState {
  projectId: string
  setProjectId: (projectId: string) => void
	clearProjectId: () => void
}

export const useAdminStore = create<AdminState>((set) => ({
	projectId: '',
  setProjectId: (projectId) => set({ projectId }),
	clearProjectId: () => set({ projectId: '' }),
}))
