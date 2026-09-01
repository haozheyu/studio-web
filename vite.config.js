import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
    plugins: [vue()],
    server: {
        port: 4173,
        proxy: {
            '/api/deepseek': { target: 'http://10.221.34.101:8000', changeOrigin: true, rewrite: function (p) { return p.replace(/^\/api\/deepseek/, ''); } },
            '/api/flux': { target: 'http://10.221.34.101:8096', changeOrigin: true, rewrite: function (p) { return p.replace(/^\/api\/flux/, ''); } },
            '/api/minimax': { target: 'http://10.221.34.101:8091', changeOrigin: true, rewrite: function (p) { return p.replace(/^\/api\/minimax/, ''); } }
        }
    }
});
