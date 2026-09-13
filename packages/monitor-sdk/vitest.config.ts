import { defineConfig } from 'vitest/config'
import { heartbeatWorkerDefine } from './build/heartbeat-worker.ts'

export default defineConfig(async () => ({
  define: await heartbeatWorkerDefine(),
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
}))
