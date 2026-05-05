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

// When a new service worker takes over, reload to get the latest version.
// This fixes the issue where Ctrl+F5 was needed to see fresh content.
// Using the native API instead of virtual:pwa-register for Vite 8/Rolldown compatibility.
async function setupPWAAutoUpdate() {
  if (!('serviceWorker' in navigator)) {
    return
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

    // Detect when the SW starts installing a new version
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing
      if (!newWorker) {
        return
      }

      newWorker.addEventListener('statechange', () => {
        // When the new SW is activated, reload to let it take control
        if (newWorker.state === 'activated') {
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
