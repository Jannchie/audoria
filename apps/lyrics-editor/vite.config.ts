import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths, so the build can be served from any subpath or opened as static files.
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@audoria/lyrics-core': fileURLToPath(new URL('../../packages/lyrics-core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5873,
  },
})
