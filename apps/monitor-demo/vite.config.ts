import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function demoScenarioAPI(): Plugin {
  return {
    name: 'monitor-demo-scenario-api',
    configureServer(server) {
      server.middlewares.use('/api/demo/success', (request, response, next) => {
        if (request.method !== 'GET') {
          next()
          return
        }

        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ ok: true, timestamp: Date.now() }))
      })

      server.middlewares.use('/api/demo/chat', (request, response, next) => {
        if (request.method !== 'GET') {
          next()
          return
        }

        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-cache')
        response.write('正在生成')
        setTimeout(() => response.write('浏览器 SDK'), 180)
        setTimeout(() => response.end('流式指标。'), 420)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), demoScenarioAPI()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
