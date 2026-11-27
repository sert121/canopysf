import { defineConfig } from 'vite'
import { resolve } from 'path'
export default defineConfig({ base: './', build: { target: 'es2022', chunkSizeWarningLimit: 3000,
  rollupOptions: { input: { main: resolve(__dirname, 'index.html'), ...(process.env.DEV_PAGES ? { gputest: resolve(__dirname, 'gputest.html') } : {}) } } } })
