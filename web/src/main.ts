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

// Register the service worker and auto-reload when a new version takes over,
// so users see fresh content without needing Ctrl+F5.
async function setupPWAAutoUpdate() {
  if (!('serviceWorker' in navigator)) {
    return
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

    const isUpdate = Boolean(registration.active)

    // When the new SW has claimed this client, reload.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isUpdate) globalThis.location.reload()
    })

    function notify(worker: ServiceWorker | null) {
      if (!worker) return
      worker.postMessage({ type: 'SKIP_WAITING' })
    }

    // An update may already be in progress when this script runs.
    notify(registration.installing)
    notify(registration.waiting)

    // Listen for updates that start after the page loads.
    registration.addEventListener('updatefound', () => notify(registration.installing))
  }
  catch (error) {
    console.warn('[PWA] SW registration failed:', error)
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
