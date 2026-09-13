import { defineConfig } from 'tsup'
import { heartbeatWorkerDefine } from './build/heartbeat-worker.ts'

export default defineConfig(async () => ({
  entry: ['src/index.ts', 'src/plugins/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,

  // 新增
  metafile: true,
  minify: true,
  platform: 'browser',
  target: 'es2020',
  define: await heartbeatWorkerDefine(),
}))
