<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettings } from '../composables/useSettings'
import { localeLabels, type LocalePreference } from '../i18n/locales'

const { t } = useI18n()
const { localePreference, effectiveLocale, setLocalePreference } = useSettings()

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
        <p class="section-description">
          {{ t('settings.language.description') }}
        </p>
      </div>

      <div class="option-list">
        <button
          v-for="option in languageOptions"
          :key="option.value"
          type="button"
          class="option-row"
          :class="{ 'option-row--active': localePreference === option.value }"
          :aria-pressed="localePreference === option.value"
          @click="setLocalePreference(option.value)"
        >
          <span class="option-main">
            <span class="option-label">{{ option.label }}</span>
            <span
              v-if="option.hint"
              class="option-hint"
            >
              {{ option.hint }}
            </span>
          </span>
          <span
            class="option-indicator"
            :class="{ 'option-indicator--active': localePreference === option.value }"
            aria-hidden="true"
          />
        </button>
      </div>

      <p class="settings-footnote">
        {{ t('settings.language.effectiveLocale') }}: {{ localeLabels[effectiveLocale] }}
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
  gap: 1rem;
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
  flex-direction: column;
  gap: 0.5rem;
}

.option-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border: 1px solid transparent;
  border-radius: 0.875rem;
  background: var(--bg-primary);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.option-row:hover {
  background: var(--bg-elevated);
}

.option-row--active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.option-main {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.option-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.option-hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.option-indicator {
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 999px;
  border: 2px solid var(--text-tertiary);
  flex-shrink: 0;
}

.option-indicator--active {
  border-color: var(--accent);
  background: var(--accent);
}

.settings-footnote {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
</style>
