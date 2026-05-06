import { computed, ref } from 'vue'
import { client } from '../api/client.gen'

export type AuthStatus = 'loading' | 'authenticated' | 'guest'

export const GUEST_RESTRICTED_PATHS = ['/upload', '/import', '/parse'] as const

export const authStatus = ref<AuthStatus>('loading')

const GUEST_STORAGE_KEY = 'audoria.guest-mode'

function apiUrl(path: string): string {
  const base = client.getConfig().baseUrl ?? ''
  return `${base}${path}`
}

function getStoredGuestFlag(): boolean {
  try {
    return globalThis.localStorage.getItem(GUEST_STORAGE_KEY) === 'true'
  }
  catch {
    return false
  }
}

function setStoredGuestFlag(value: boolean): void {
  try {
    if (value) {
      globalThis.localStorage.setItem(GUEST_STORAGE_KEY, 'true')
    }
    else {
      globalThis.localStorage.removeItem(GUEST_STORAGE_KEY)
    }
  }
  catch {
    // localStorage unavailable
  }
}

export function useAuth() {
  async function check(): Promise<void> {
    // If guest mode was active on last visit, skip auth check
    if (getStoredGuestFlag()) {
      authStatus.value = 'guest'
      return
    }

    try {
      const response = await globalThis.fetch(apiUrl('/auth/check'), { credentials: 'include' })
      if (response.ok) {
        authStatus.value = 'authenticated'
        setStoredGuestFlag(false)
        return
      }
      // Auth server rejected — persist guest
      if (response.status === 401 || response.status === 403) {
        authStatus.value = 'guest'
        setStoredGuestFlag(true)
        return
      }
    }
    catch {
      // Network error — guest without persisting, retry next visit
    }

    authStatus.value = 'guest'
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
        setStoredGuestFlag(false)
        authStatus.value = 'authenticated'
        return { ok: true, message: data.message ?? 'Authenticated' }
      }
      return { ok: false, message: data.message ?? 'Authentication failed' }
    }
    catch {
      return { ok: false, message: 'Network error' }
    }
  }

  const isGuest = computed(() => authStatus.value === 'guest')
  const isAuthenticated = computed(() => authStatus.value === 'authenticated')

  return {
    status: authStatus,
    isGuest,
    isAuthenticated,
    check,
    login,
  }
}
