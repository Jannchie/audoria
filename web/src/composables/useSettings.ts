import type { CoverEffectPreset } from '../constants/coverEffects'
import type { LocalePreference } from '../i18n/locales'
import { computed, reactive, readonly } from 'vue'
import { defaultCoverEffectPreset, isCoverEffectPreset, legacyCoverEffectPresetMap } from '../constants/coverEffects'
import { isLocalePreference, resolveLocale } from '../i18n/locales'

const settingsStorageKey = 'audoria.settings'

interface AppSettings {
  localePreference: LocalePreference
  coverEffect: CoverEffectPreset
}

const defaultSettings: AppSettings = {
  localePreference: 'system',
  coverEffect: defaultCoverEffectPreset,
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

    const normalizedCoverEffect = typeof parsed.coverEffect === 'string'
      ? (legacyCoverEffectPresetMap[parsed.coverEffect as keyof typeof legacyCoverEffectPresetMap] ?? parsed.coverEffect)
      : parsed.coverEffect

    return {
      localePreference: isLocalePreference(parsed.localePreference)
        ? parsed.localePreference
        : defaultSettings.localePreference,
      coverEffect: isCoverEffectPreset(normalizedCoverEffect)
        ? normalizedCoverEffect
        : defaultSettings.coverEffect,
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

export function setCoverEffect(coverEffect: CoverEffectPreset): void {
  settings.coverEffect = coverEffect
  persistSettings()
}

export function useSettings() {
  const effectiveLocale = computed(() => resolveLocale(settings.localePreference))

  return {
    settings: readonly(settings),
    localePreference: computed(() => settings.localePreference),
    coverEffect: computed(() => settings.coverEffect),
    effectiveLocale,
    setLocalePreference,
    setCoverEffect,
  }
}
