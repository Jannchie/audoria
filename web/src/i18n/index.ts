import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import { settings } from '../composables/useSettings'
import { resolveLocale } from './locales'
import { messages } from './messages'

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: resolveLocale(settings.value.localePreference),
  fallbackLocale: 'en-US',
  messages,
})

function syncLocale(): void {
  const locale = resolveLocale(settings.value.localePreference)
  i18n.global.locale.value = locale

  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

watch(() => settings.value.localePreference, syncLocale, { immediate: true })

export function translate(key: string, params?: Record<string, unknown>): string {
  return params ? i18n.global.t(key, params) : i18n.global.t(key)
}
