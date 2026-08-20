import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const repositoryRoot = resolve(import.meta.dirname, '../..')

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, repositoryRoot, '')
  const managementToken = environment.MANAGEMENT_API_TOKEN
  const apiOrigin = environment.MONITOR_API_ORIGIN || 'http://127.0.0.1:8080'

  return {
    envDir: repositoryRoot,
    plugins: [react()],
    resolve: {
      alias: { '@': resolve(import.meta.dirname, 'src') },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'data-vendor': ['@tanstack/react-query', 'zustand'],
            'ui-vendor': [
              '@hookform/resolvers/zod',
              '@mantine/core',
              '@mantine/hooks',
              'react-hook-form',
              'zod',
            ],
          },
        },
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        '/management-api': {
          target: apiOrigin,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/management-api/, ''),
          configure(proxy) {
            proxy.on('proxyReq', (proxyRequest) => {
              if (managementToken) {
                proxyRequest.setHeader('Authorization', `Bearer ${managementToken}`)
              }
            })
          },
        },
      },
    },
  }
})
