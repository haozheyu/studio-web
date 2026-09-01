import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [vue()],
    server: {
      port: 4173,
      proxy: {
        '/studio-api': {
          target: env.STUDIO_API || 'http://127.0.0.1:8787',
          changeOrigin: true,
          rewrite: p => p.replace(/^\/studio-api/, '')
        },
        '/api/deepseek': {
          target: env.DEEPSEEK_API,
          changeOrigin: true,
          rewrite: p => p.replace(/^\/api\/deepseek/, '')
        },
        '/api/flux': {
          target: env.FLUX_API,
          changeOrigin: true,
          rewrite: p => p.replace(/^\/api\/flux/, '')
        },
        '/api/minimax': {
          target: env.MINIMAX_API,
          changeOrigin: true,
          rewrite: p => p.replace(/^\/api\/minimax/, '')
        }
      }
    }
  }
})