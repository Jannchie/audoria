import { ref } from 'vue'
import { client } from '../api/client.gen'

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated'

const status = ref<AuthStatus>('loading')

function apiUrl(path: string): string {
  const base = client.getConfig().baseUrl ?? ''
  return `${base}${path}`
}

export function useAuth() {
  async function check(): Promise<void> {
    try {
      const response = await globalThis.fetch(apiUrl('/auth/check'), { credentials: 'include' })
      if (response.ok) {
        status.value = 'authenticated'
      }
      else if (response.status === 401) {
        status.value = 'unauthenticated'
      }
      else {
        // Auth not configured or server error — allow access
        status.value = 'authenticated'
      }
    }
    catch {
      // Network error — treat as unauthenticated
      status.value = 'unauthenticated'
    }
  }

  async function login(token: string): Promise<{ ok: boolean, message: string }> {
    try {
      const response = await globalThis.fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string }
      if (response.ok) {
        status.value = 'authenticated'
        return { ok: true, message: data.message ?? 'Authenticated' }
      }
      return { ok: false, message: data.message ?? 'Authentication failed' }
    }
    catch {
      return { ok: false, message: 'Network error' }
    }
  }

  return {
    status,
    check,
    login,
  }
}
