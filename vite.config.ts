import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', proxy: { '/api/': 'http://127.0.0.1:3001' } },
})
