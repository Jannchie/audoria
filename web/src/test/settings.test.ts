import { beforeEach, describe, expect, it, vi } from 'vitest'

const settingsStorageKey = 'audoria.settings'

class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

async function loadSettings() {
  vi.resetModules()
  return await import('../composables/useSettings')
}

describe('useSettings', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('navigator', { language: 'en-US' })
  })

  it('restores the locale preference from persisted state', async () => {
    globalThis.localStorage.setItem(settingsStorageKey, JSON.stringify({
      localePreference: 'zh-CN',
    }))

    const { useSettings } = await loadSettings()
    const settings = useSettings()

    expect(settings.localePreference.value).toBe('zh-CN')
    expect(settings.effectiveLocale.value).toBe('zh-CN')
  })

  it('resolves system preference from the browser language', async () => {
    vi.stubGlobal('navigator', { language: 'zh-TW' })

    const { useSettings } = await loadSettings()
    const settings = useSettings()

    expect(settings.localePreference.value).toBe('system')
    expect(settings.effectiveLocale.value).toBe('zh-CN')
  })

  it('persists locale preference updates', async () => {
    const { setLocalePreference, useSettings } = await loadSettings()

    setLocalePreference('zh-CN')

    const settings = useSettings()
    const persisted = JSON.parse(globalThis.localStorage.getItem(settingsStorageKey) ?? '{}') as {
      localePreference?: string
    }

    expect(settings.localePreference.value).toBe('zh-CN')
    expect(persisted.localePreference).toBe('zh-CN')
  })
})
