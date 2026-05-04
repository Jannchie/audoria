import type { CoverEffectPreset } from '../constants/coverEffects'
import type { LocalePreference } from '../i18n/locales'
import { computed } from 'vue'
import { defaultCoverEffectPreset, isCoverEffectPreset, legacyCoverEffectPresetMap } from '../constants/coverEffects'
import { isLocalePreference, resolveLocale } from '../i18n/locales'

const settingsStorageKey = 'audoria.settings'

interface AppSettings {
  localePreference: LocalePreference
  coverEffect: CoverEffectPreset
  coverEffectEnabled: boolean
  progressEffectEnabled: boolean
}

const defaultSettings: AppSettings = {
  localePreference: 'system',
  coverEffect: defaultCoverEffectPreset,
  coverEffectEnabled: true,
  progressEffectEnabled: true,
}

function getStorage(): Storage | undefined {
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    return globalThis.localStorage as Storage
  }
  return undefined
}

function readSettings(raw: string): AppSettings {
  const parsed = JSON.parse(raw) as Partial<AppSettings>
  const normalizedCoverEffect = typeof parsed.coverEffect === 'string'
    ? (legacyCoverEffectPresetMap[parsed.coverEffect as keyof typeof legacyCoverEffectPresetMap] ?? parsed.coverEffect)
    : parsed.coverEffect
  return {
    localePreference: isLocalePreference(parsed.localePreference) ? parsed.localePreference : defaultSettings.localePreference,
    coverEffect: isCoverEffectPreset(normalizedCoverEffect) ? normalizedCoverEffect : defaultSettings.coverEffect,
    coverEffectEnabled: typeof parsed.coverEffectEnabled === 'boolean' ? parsed.coverEffectEnabled : defaultSettings.coverEffectEnabled,
    progressEffectEnabled: typeof parsed.progressEffectEnabled === 'boolean' ? parsed.progressEffectEnabled : defaultSettings.progressEffectEnabled,
  }
}

function writeSettings(v: AppSettings): string {
  return JSON.stringify(v)
}

export const settings = useStorage<AppSettings>(
  settingsStorageKey,
  defaultSettings,
  getStorage(),
  {
    mergeDefaults: true,
    flush: 'sync',
    serializer: { read: readSettings, write: writeSettings },
  },
)

export function setLocalePreference(localePreference: LocalePreference): void {
  settings.value = { ...settings.value, localePreference }
}

export function setCoverEffect(coverEffect: CoverEffectPreset): void {
  settings.value = { ...settings.value, coverEffect }
}

export function setCoverEffectEnabled(enabled: boolean): void {
  settings.value = { ...settings.value, coverEffectEnabled: enabled }
}

export function setProgressEffectEnabled(enabled: boolean): void {
  settings.value = { ...settings.value, progressEffectEnabled: enabled }
}

export function useSettings() {
  const effectiveLocale = computed(() => resolveLocale(settings.value.localePreference))

  return {
    settings: computed(() => settings.value),
    localePreference: computed(() => settings.value.localePreference),
    coverEffect: computed(() => settings.value.coverEffect),
    coverEffectEnabled: computed(() => settings.value.coverEffectEnabled),
    progressEffectEnabled: computed(() => settings.value.progressEffectEnabled),
    effectiveLocale,
    setLocalePreference,
    setCoverEffect,
    setCoverEffectEnabled,
    setProgressEffectEnabled,
  }
}
