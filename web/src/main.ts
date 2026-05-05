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

// Auto-reload when a new service worker takes over, so users see fresh content
// without needing Ctrl+F5. Uses the native SW API for Vite 8/Rolldown compatibility.
async function setupPWAAutoUpdate() {
  if (!('serviceWorker' in navigator)) {
    return
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

    // Avoid reloading on first-time install — only reload for actual updates.
    // `registration.active` is null on the very first registration.
    const isUpdate = Boolean(registration.active)

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing
      if (!newWorker) {
        return
      }

      // Tell the new SW to activate immediately.
      // The SW also calls self.skipWaiting() at install time via workbox config,
      // but this covers edge cases (e.g. SW already in waiting state).
      newWorker.postMessage({ type: 'SKIP_WAITING' })

      newWorker.addEventListener('statechange', () => {
        // Reload only for genuine updates, not the initial install
        if (isUpdate && newWorker.state === 'activated') {
          globalThis.location.reload()
        }
      })
    })
  }
  catch (error) {
    console.warn('[PWA] Service worker registration failed:', error)
  }
}

setupPWAAutoUpdate()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

const apiBase = import.meta.env.VITE_API_BASE ?? '/api/v1'
client.setConfig({
  baseUrl: apiBase,
  fetch: (input, init) => globalThis.fetch(input, { ...init, credentials: 'include' }),
})

createApp(App).use(i18n).use(router).use(VueQueryPlugin, { queryClient }).mount('#app')
