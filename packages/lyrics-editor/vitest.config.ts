import vue from '@vitejs/plugin-vue'
import { defaultServerConditions } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  ssr: {
    resolve: {
      conditions: ['source', ...defaultServerConditions],
    },
  },
})
