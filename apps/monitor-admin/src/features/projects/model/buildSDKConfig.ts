import type { ProjectDetail } from '@/features/projects/model/projectTypes'

export function buildSDKConfig(project: ProjectDetail) {
  return `createMonitor({
  url: 'http://127.0.0.1:8080/api/v1/events/batch',
  projectName: '${escapeJavaScriptString(project.name)}',
  appId: '${escapeJavaScriptString(project.id)}',
  publicKey: '${escapeJavaScriptString(project.publicKey)}',
})`
}

function escapeJavaScriptString(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}
