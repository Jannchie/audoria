import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@audoria/lyrics-core': fileURLToPath(new URL('../lyrics-core/src/index.ts', import.meta.url)),
    },
  },
})
