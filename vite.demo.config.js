import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        basic: resolve(import.meta.dirname, 'basic.html'),
        pbr: resolve(import.meta.dirname, 'pbr.html')
      }
    },
    outDir: 'demo-dist'
  }
})
