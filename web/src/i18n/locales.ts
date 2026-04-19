export const supportedLocales = ['en-US', 'zh-CN'] as const

export type SupportedLocale = typeof supportedLocales[number]
export type LocalePreference = SupportedLocale | 'system'

export const defaultLocale: SupportedLocale = 'en-US'

export const localeLabels: Record<SupportedLocale, string> = {
  'en-US': 'English',
  'zh-CN': '简体中文',
}

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && supportedLocales.includes(value as SupportedLocale)
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isSupportedLocale(value)
}

export function getBrowserLanguage(): string {
  if (typeof navigator === 'undefined') {
    return defaultLocale
  }
  return navigator.language || defaultLocale
}

export function resolveLocale(preference: LocalePreference, language = getBrowserLanguage()): SupportedLocale {
  if (isSupportedLocale(preference)) {
    return preference
  }

  const normalized = language.toLowerCase()
  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }

  return defaultLocale
}
