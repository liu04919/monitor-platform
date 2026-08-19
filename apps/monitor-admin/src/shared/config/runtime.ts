export const runtimeConfig = {
  projectId: import.meta.env.VITE_MONITOR_PROJECT_ID?.trim() || 'monitor-local',
} as const
