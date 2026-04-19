<script setup lang="ts">
import type { LocalePreference } from '../i18n/locales'
import { coverEffectDefinitions } from '../constants/coverEffects'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettings } from '../composables/useSettings'
import { localeLabels } from '../i18n/locales'

const { t } = useI18n()
const {
  localePreference,
  effectiveLocale,
  coverEffect,
  setLocalePreference,
  setCoverEffect,
} = useSettings()

const languageOptions = computed<Array<{ value: LocalePreference, label: string, hint?: string }>>(() => [
  {
    value: 'system',
    label: t('settings.language.followSystem'),
    hint: t('settings.language.currentValue', { language: localeLabels[effectiveLocale.value] }),
  },
  {
    value: 'en-US',
    label: localeLabels['en-US'],
  },
  {
    value: 'zh-CN',
    label: localeLabels['zh-CN'],
  },
])

const coverEffectOptions = computed(() => coverEffectDefinitions.map(definition => ({
  value: definition.value,
  label: t(`settings.coverEffect.options.${definition.value}`),
})))
</script>

<template>
  <section class="settings-page">
    <header class="settings-header">
      <h1 class="settings-title">
        {{ t('settings.title') }}
      </h1>
      <p class="settings-description">
        {{ t('settings.description') }}
      </p>
    </header>

    <section class="settings-section">
      <div class="section-header">
        <h2 class="section-title">
          {{ t('settings.language.title') }}
        </h2>
      </div>

      <div class="option-list">
        <button
          v-for="option in languageOptions"
          :key="option.value"
          type="button"
          class="option-chip"
          :class="{ 'option-chip--active': localePreference === option.value }"
          :aria-pressed="localePreference === option.value"
          @click="setLocalePreference(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <p class="section-description">
        {{ t('settings.language.description') }}
      </p>

      <p class="settings-footnote">
        {{
          languageOptions.find(option => option.value === localePreference)?.hint
            ?? `${t('settings.language.effectiveLocale')}: ${localeLabels[effectiveLocale]}`
        }}
      </p>
    </section>

    <section class="settings-section">
      <div class="section-header">
        <h2 class="section-title">
          {{ t('settings.coverEffect.title') }}
        </h2>
      </div>

      <div class="option-list">
        <button
          v-for="option in coverEffectOptions"
          :key="option.value"
          type="button"
          class="option-chip"
          :class="{ 'option-chip--active': coverEffect === option.value }"
          :aria-pressed="coverEffect === option.value"
          @click="setCoverEffect(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <p class="section-description">
        {{ t('settings.coverEffect.description') }}
      </p>

      <p class="settings-footnote">
        {{
          t('settings.coverEffect.currentValue', {
            effect: coverEffectOptions.find(option => option.value === coverEffect)?.label ?? coverEffect,
          })
        }}
      </p>
    </section>
  </section>
</template>

<style scoped>
.settings-page {
  padding-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

@media (min-width: 768px) {
  .settings-page {
    padding-top: 1rem;
  }
}

.settings-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.settings-title {
  margin: 0;
  font-size: 1.5rem;
  color: var(--text-primary);
}

.settings-description {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 1rem;
  background: var(--bg-surface);
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.section-title {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary);
}

.section-description {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.option-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.option-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.25rem;
  padding: 0 0.875rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.option-chip:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.option-chip--active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text-primary);
}

.settings-footnote {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
</style>
