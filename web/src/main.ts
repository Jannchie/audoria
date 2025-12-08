import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createApp } from 'vue'
import { client } from './api/client.gen'
import App from './App.vue'
import router from './router'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './style.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787'
client.setConfig({ baseUrl: apiBase })

createApp(App).use(router).use(VueQueryPlugin, { queryClient }).mount('#app')
