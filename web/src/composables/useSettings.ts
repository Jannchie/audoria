import { computed, readonly, reactive } from 'vue'
import { isLocalePreference, type LocalePreference, resolveLocale } from '../i18n/locales'

const settingsStorageKey = 'audoria.settings'

interface AppSettings {
  localePreference: LocalePreference
}

const defaultSettings: AppSettings = {
  localePreference: 'system',
}

function canUseStorage(): boolean {
  return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
}

function readPersistedSettings(): AppSettings {
  if (!canUseStorage()) {
    return { ...defaultSettings }
  }

  try {
    const raw = globalThis.localStorage.getItem(settingsStorageKey)
    if (!raw) {
      return { ...defaultSettings }
    }

    const parsed = JSON.parse(raw) as Partial<AppSettings>

    return {
      localePreference: isLocalePreference(parsed.localePreference)
        ? parsed.localePreference
        : defaultSettings.localePreference,
    }
  }
  catch {
    return { ...defaultSettings }
  }
}

function persistSettings(): void {
  if (!canUseStorage()) {
    return
  }

  try {
    globalThis.localStorage.setItem(settingsStorageKey, JSON.stringify(settings))
  }
  catch {
    // Ignore storage write failures.
  }
}

export const settings = reactive<AppSettings>(readPersistedSettings())

export function setLocalePreference(localePreference: LocalePreference): void {
  settings.localePreference = localePreference
  persistSettings()
}

export function useSettings() {
  const effectiveLocale = computed(() => resolveLocale(settings.localePreference))

  return {
    settings: readonly(settings),
    localePreference: computed(() => settings.localePreference),
    effectiveLocale,
    setLocalePreference,
  }
}
