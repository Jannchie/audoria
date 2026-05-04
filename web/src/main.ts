import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createApp } from 'vue'
import { client } from './api/client.gen'
import App from './App.vue'
import { i18n } from './i18n'
import router from './router'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './style.css'

// Suppress the noisy THREE.Clock deprecation warning emitted by
// `@shader-gradient/vue`'s bundled three build. Not our code; can't patch.
const originalWarn = console.warn.bind(console)
console.warn = (...args: unknown[]): void => {
  const first = args[0]
  if (typeof first === 'string' && first.includes('THREE.Clock')) {
    return
  }
  originalWarn(...args)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787'
client.setConfig({
  baseUrl: apiBase,
  fetch: (input, init) => globalThis.fetch(input, { ...init, credentials: 'include' }),
})

createApp(App).use(i18n).use(router).use(VueQueryPlugin, { queryClient }).mount('#app')
