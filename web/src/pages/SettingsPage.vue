<script setup lang="ts">
import type { LocalePreference } from '../i18n/locales'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettings } from '../composables/useSettings'
import { coverEffectDefinitions } from '../constants/coverEffects'
import { localeLabels } from '../i18n/locales'

const { t } = useI18n()
const {
  localePreference,
  effectiveLocale,
  coverEffect,
  coverEffectEnabled,
  progressEffectEnabled,
  setLocalePreference,
  setCoverEffect,
  setCoverEffectEnabled,
  setProgressEffectEnabled,
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

const activeLanguageHint = computed(() => {
  return languageOptions.value.find(option => option.value === localePreference.value)?.hint
    ?? `${t('settings.language.effectiveLocale')}: ${localeLabels[effectiveLocale.value]}`
})
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

    <section class="settings-group">
      <h2 class="group-title">
        {{ t('settings.groups.appearance') }}
      </h2>
      <div class="group-card">
        <div class="field-row">
          <div class="field-text">
            <div class="field-label">
              {{ t('settings.language.title') }}
            </div>
            <div class="field-hint">
              {{ t('settings.language.description') }}
            </div>
          </div>
          <div class="field-control field-control--chips">
            <button
              v-for="option in languageOptions"
              :key="option.value"
              type="button"
              class="chip"
              :class="{ 'chip--active': localePreference === option.value }"
              :aria-pressed="localePreference === option.value"
              @click="setLocalePreference(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <div class="field-footnote">
          {{ activeLanguageHint }}
        </div>
      </div>
    </section>

    <section class="settings-group">
      <h2 class="group-title">
        {{ t('settings.groups.playback') }}
      </h2>
      <div class="group-card">
        <div class="field-row">
          <div class="field-text">
            <div class="field-label">
              {{ t('settings.coverEffectEnabled.title') }}
            </div>
            <div class="field-hint">
              {{ t('settings.coverEffectEnabled.description') }}
            </div>
          </div>
          <div class="field-control">
            <button
              type="button"
              class="toggle"
              :class="{ 'toggle--on': coverEffectEnabled }"
              :aria-checked="coverEffectEnabled"
              :aria-label="t('settings.coverEffectEnabled.title')"
              role="switch"
              @click="setCoverEffectEnabled(!coverEffectEnabled)"
            >
              <span class="toggle__thumb" />
            </button>
          </div>
        </div>

        <div
          class="field-row"
          :class="{ 'field-row--disabled': !coverEffectEnabled }"
        >
          <div class="field-text">
            <div class="field-label">
              {{ t('settings.coverEffect.title') }}
            </div>
            <div class="field-hint">
              {{ t('settings.coverEffect.description') }}
            </div>
          </div>
          <div class="field-control field-control--chips">
            <button
              v-for="option in coverEffectOptions"
              :key="option.value"
              type="button"
              class="chip"
              :class="{ 'chip--active': coverEffect === option.value }"
              :disabled="!coverEffectEnabled"
              :aria-pressed="coverEffect === option.value"
              @click="setCoverEffect(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="field-row">
          <div class="field-text">
            <div class="field-label">
              {{ t('settings.progressEffectEnabled.title') }}
            </div>
            <div class="field-hint">
              {{ t('settings.progressEffectEnabled.description') }}
            </div>
          </div>
          <div class="field-control">
            <button
              type="button"
              class="toggle"
              :class="{ 'toggle--on': progressEffectEnabled }"
              :aria-checked="progressEffectEnabled"
              :aria-label="t('settings.progressEffectEnabled.title')"
              role="switch"
              @click="setProgressEffectEnabled(!progressEffectEnabled)"
            >
              <span class="toggle__thumb" />
            </button>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.settings-page {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 1rem 0 3rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.settings-header {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0 0.25rem;
}

.settings-title {
  margin: 0;
  font-size: 1.625rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.settings-description {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-title {
  margin: 0;
  padding: 0 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.group-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  overflow: hidden;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.125rem;
  border-top: 1px solid var(--border);
  transition: opacity 180ms ease;
}

.field-row:first-child {
  border-top: none;
}

.field-row--disabled {
  opacity: 0.55;
}

.field-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-label {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.35;
}

.field-hint {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.45;
}

.field-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.field-control--chips {
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 60%;
}

.field-footnote {
  padding: 0.5rem 1.125rem 0.875rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2rem;
  padding: 0 0.875rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
}

.chip:hover:not(:disabled) {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.chip--active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text-primary);
}

.chip:disabled {
  cursor: not-allowed;
}

.toggle {
  position: relative;
  width: 2.75rem;
  height: 1.5rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-primary);
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease;
}

.toggle__thumb {
  position: absolute;
  top: 50%;
  left: 0.125rem;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 50%;
  background: var(--text-secondary);
  transform: translateY(-50%);
  transition: transform 180ms ease, background 180ms ease;
}

.toggle--on {
  background: var(--accent);
  border-color: var(--accent);
}

.toggle--on .toggle__thumb {
  transform: translate(1.25rem, -50%);
  background: #fff;
}

.toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .field-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .field-control {
    justify-content: flex-start;
  }

  .field-control--chips {
    max-width: 100%;
    justify-content: flex-start;
  }
}
</style>
