import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        basic: resolve(import.meta.dirname, 'index.html'),
        pbr: resolve(import.meta.dirname, 'pbr.html')
      }
    },
    outDir: 'demo-dist'
  }
})
