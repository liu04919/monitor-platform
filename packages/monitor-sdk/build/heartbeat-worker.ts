import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// 先编译 Worker 的依赖，再作为字符串内嵌，ESM/CJS 使用同一份产物。
export async function heartbeatWorkerDefine(): Promise<Record<string, string>> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/stability/heartbeat/worker.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    minify: true,
  })
  return { __MONITOR_HEARTBEAT_WORKER__: JSON.stringify(result.outputFiles[0].text) }
}
