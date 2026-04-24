<script setup lang="ts">
import type { MusicDlSource } from '../api/types.gen'
import type { AppConfigUpdate, MusicDlUrlSource } from '../composables/useAppConfig'
import type { LocalePreference } from '../i18n/locales'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppConfigQuery, useUpdateAppConfig } from '../composables/useAppConfig'
import { useSettings } from '../composables/useSettings'
import { coverEffectDefinitions } from '../constants/coverEffects'
import { localeLabels } from '../i18n/locales'
import { getSourceDisplay } from '../utils/source'

interface RuntimeForm {
  dbPath: string
  storageBackend: 'fs' | 's3'
  fsRootDir: string
  s3Bucket: string
  s3Endpoint: string
  s3Region: string
  s3ForcePathStyle: boolean
  s3AccessKeyId: string
  s3SecretAccessKey: string
  sources: MusicDlSource[]
  urlSources: MusicDlUrlSource[]
  searchTimeoutMs: number
  downloadTimeoutMs: number
  candidateTtlMs: number
  workerPollMs: number
}

const allMusicSources: MusicDlSource[] = [
  'NeteaseMusicClient',
  'QQMusicClient',
  'KuwoMusicClient',
  'MiguMusicClient',
  'JamendoMusicClient',
]

const allUrlSources: MusicDlUrlSource[] = ['Bilibili', 'Youtube']

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

const appConfigQuery = useAppConfigQuery()
const updateAppConfig = useUpdateAppConfig()

const appConfig = computed(() => appConfigQuery.data.value)
const appConfigLoading = computed(() => appConfigQuery.isPending.value)
const appConfigFailed = computed(() => appConfigQuery.isError.value)

const runtimeForm = reactive<RuntimeForm>({
  dbPath: '',
  storageBackend: 's3',
  fsRootDir: '',
  s3Bucket: '',
  s3Endpoint: '',
  s3Region: 'us-east-1',
  s3ForcePathStyle: true,
  s3AccessKeyId: '',
  s3SecretAccessKey: '',
  sources: [...allMusicSources],
  urlSources: [...allUrlSources],
  searchTimeoutMs: 30_000,
  downloadTimeoutMs: 180_000,
  candidateTtlMs: 1_800_000,
  workerPollMs: 3000,
})

const runtimeSaveError = ref('')
const runtimeSaveSucceeded = ref(false)
const runtimeRestartRequired = ref(false)

watch(appConfig, (config) => {
  if (!config) {
    return
  }

  runtimeForm.dbPath = config.metadata.dbPath
  runtimeForm.sources = [...config.musicdl.sources]
  runtimeForm.urlSources = [...config.musicdl.urlSources]
  runtimeForm.searchTimeoutMs = config.musicdl.searchTimeoutMs
  runtimeForm.downloadTimeoutMs = config.musicdl.downloadTimeoutMs
  runtimeForm.candidateTtlMs = config.imports.candidateTtlMs
  runtimeForm.workerPollMs = config.imports.workerPollMs

  runtimeForm.storageBackend = config.storage.backend
  if (config.storage.backend === 'fs') {
    runtimeForm.fsRootDir = config.storage.rootDir
  }
  else {
    runtimeForm.s3Bucket = config.storage.bucket
    runtimeForm.s3Endpoint = config.storage.endpoint ?? ''
    runtimeForm.s3Region = config.storage.region
    runtimeForm.s3ForcePathStyle = config.storage.forcePathStyle
  }

  runtimeForm.s3AccessKeyId = ''
  runtimeForm.s3SecretAccessKey = ''
}, { immediate: true })

const credentialStatus = computed(() => {
  const storage = appConfig.value?.storage
  if (!storage || storage.backend !== 's3') {
    return ''
  }
  return storage.accessKeyConfigured && storage.secretKeyConfigured
    ? t('settings.runtime.credentials.configured')
    : t('settings.runtime.credentials.missing')
})

const runtimeSaveDisabled = computed(() => {
  return updateAppConfig.isPending.value
    || runtimeForm.sources.length === 0
    || runtimeForm.urlSources.length === 0
})
const runtimeSaving = computed(() => updateAppConfig.isPending.value)

function isMusicSourceSelected(source: MusicDlSource): boolean {
  return runtimeForm.sources.includes(source)
}

function isUrlSourceSelected(source: MusicDlUrlSource): boolean {
  return runtimeForm.urlSources.includes(source)
}

function toggleMusicSource(source: MusicDlSource): void {
  if (runtimeForm.sources.includes(source)) {
    if (runtimeForm.sources.length > 1) {
      runtimeForm.sources = runtimeForm.sources.filter(item => item !== source)
    }
    return
  }
  runtimeForm.sources = [...runtimeForm.sources, source]
}

function toggleUrlSource(source: MusicDlUrlSource): void {
  if (runtimeForm.urlSources.includes(source)) {
    if (runtimeForm.urlSources.length > 1) {
      runtimeForm.urlSources = runtimeForm.urlSources.filter(item => item !== source)
    }
    return
  }
  runtimeForm.urlSources = [...runtimeForm.urlSources, source]
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.floor(Number(value) || 1))
}

function buildRuntimeUpdate(): AppConfigUpdate {
  return {
    metadata: {
      dbPath: runtimeForm.dbPath.trim(),
    },
    storage: runtimeForm.storageBackend === 'fs'
      ? {
          backend: 'fs',
          rootDir: runtimeForm.fsRootDir.trim(),
        }
      : {
          backend: 's3',
          bucket: runtimeForm.s3Bucket.trim(),
          endpoint: runtimeForm.s3Endpoint.trim() || null,
          region: runtimeForm.s3Region.trim(),
          forcePathStyle: runtimeForm.s3ForcePathStyle,
          accessKeyId: runtimeForm.s3AccessKeyId.trim() || undefined,
          secretAccessKey: runtimeForm.s3SecretAccessKey.trim() || undefined,
        },
    musicdl: {
      sources: runtimeForm.sources,
      urlSources: runtimeForm.urlSources,
      searchTimeoutMs: positiveInteger(runtimeForm.searchTimeoutMs),
      downloadTimeoutMs: positiveInteger(runtimeForm.downloadTimeoutMs),
    },
    imports: {
      candidateTtlMs: positiveInteger(runtimeForm.candidateTtlMs),
      workerPollMs: positiveInteger(runtimeForm.workerPollMs),
    },
  }
}

async function saveRuntimeConfig(): Promise<void> {
  runtimeSaveError.value = ''
  runtimeSaveSucceeded.value = false
  runtimeRestartRequired.value = false
  try {
    const result = await updateAppConfig.mutateAsync(buildRuntimeUpdate())
    runtimeSaveSucceeded.value = true
    runtimeRestartRequired.value = result.restartRequired
  }
  catch (error) {
    runtimeSaveError.value = error instanceof Error ? error.message : t('settings.runtime.save.failed')
  }
}

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
        {{ t('settings.groups.runtime') }}
      </h2>
      <div class="group-card">
        <div
          v-if="appConfigLoading"
          class="field-row field-row--stacked"
        >
          <div class="field-text">
            <div class="field-label">
              {{ t('settings.runtime.loading.title') }}
            </div>
            <div class="field-hint">
              {{ t('settings.runtime.loading.description') }}
            </div>
          </div>
        </div>

        <div
          v-else-if="appConfigFailed || !appConfig"
          class="field-row field-row--stacked"
        >
          <div class="field-text">
            <div class="field-label">
              {{ t('settings.runtime.loadFailed.title') }}
            </div>
            <div class="field-hint">
              {{ t('settings.runtime.loadFailed.description') }}
            </div>
          </div>
        </div>

        <form
          v-else
          class="runtime-form"
          @submit.prevent="saveRuntimeConfig"
        >
          <div class="field-row field-row--stacked">
            <div class="field-text">
              <div class="field-label">
                {{ t('settings.runtime.sources.title') }}
              </div>
              <div class="field-hint">
                {{ t('settings.runtime.sources.description') }}
              </div>
            </div>
            <div class="source-list">
              <button
                v-for="source in allMusicSources"
                :key="source"
                type="button"
                class="source-pill"
                :class="{ 'source-pill--active': isMusicSourceSelected(source) }"
                :aria-pressed="isMusicSourceSelected(source)"
                @click="toggleMusicSource(source)"
              >
                <span
                  class="source-pill__icon"
                  :class="getSourceDisplay(source).icon"
                  aria-hidden="true"
                />
                {{ getSourceDisplay(source).label }}
              </button>
            </div>
          </div>

          <div class="field-row field-row--stacked">
            <div class="field-text">
              <div class="field-label">
                {{ t('settings.runtime.urlSources.title') }}
              </div>
              <div class="field-hint">
                {{ t('settings.runtime.urlSources.description') }}
              </div>
            </div>
            <div class="source-list">
              <button
                v-for="source in allUrlSources"
                :key="source"
                type="button"
                class="source-pill"
                :class="{ 'source-pill--active': isUrlSourceSelected(source) }"
                :aria-pressed="isUrlSourceSelected(source)"
                @click="toggleUrlSource(source)"
              >
                <span
                  class="source-pill__icon"
                  :class="getSourceDisplay(source).icon"
                  aria-hidden="true"
                />
                {{ getSourceDisplay(source).label }}
              </button>
            </div>
          </div>

          <div class="field-row field-row--stacked">
            <div class="field-text">
              <div class="field-label">
                {{ t('settings.runtime.metadata.title') }}
              </div>
              <div class="field-hint">
                {{ t('settings.runtime.metadata.description') }}
              </div>
            </div>
            <label class="config-field">
              <span>DB_PATH</span>
              <input
                v-model="runtimeForm.dbPath"
                class="config-input"
                type="text"
                autocomplete="off"
              >
            </label>
          </div>

          <div class="field-row field-row--stacked">
            <div class="field-text">
              <div class="field-label">
                {{ t('settings.runtime.storage.title') }}
              </div>
              <div class="field-hint">
                {{ t('settings.runtime.storage.description') }}
              </div>
            </div>
            <div class="field-control field-control--chips field-control--start">
              <button
                type="button"
                class="chip"
                :class="{ 'chip--active': runtimeForm.storageBackend === 'fs' }"
                :aria-pressed="runtimeForm.storageBackend === 'fs'"
                @click="runtimeForm.storageBackend = 'fs'"
              >
                {{ t('settings.runtime.storage.backends.fs') }}
              </button>
              <button
                type="button"
                class="chip"
                :class="{ 'chip--active': runtimeForm.storageBackend === 's3' }"
                :aria-pressed="runtimeForm.storageBackend === 's3'"
                @click="runtimeForm.storageBackend = 's3'"
              >
                {{ t('settings.runtime.storage.backends.s3') }}
              </button>
            </div>

            <label
              v-if="runtimeForm.storageBackend === 'fs'"
              class="config-field"
            >
              <span>STORAGE_FS_ROOT</span>
              <input
                v-model="runtimeForm.fsRootDir"
                class="config-input"
                type="text"
                autocomplete="off"
              >
            </label>

            <div
              v-else
              class="config-fields"
            >
              <label class="config-field">
                <span>S3_BUCKET</span>
                <input
                  v-model="runtimeForm.s3Bucket"
                  class="config-input"
                  type="text"
                  autocomplete="off"
                >
              </label>
              <label class="config-field">
                <span>S3_ENDPOINT</span>
                <input
                  v-model="runtimeForm.s3Endpoint"
                  class="config-input"
                  type="url"
                  autocomplete="off"
                >
              </label>
              <label class="config-field">
                <span>S3_REGION</span>
                <input
                  v-model="runtimeForm.s3Region"
                  class="config-input"
                  type="text"
                  autocomplete="off"
                >
              </label>
              <label class="config-field config-field--inline">
                <span>S3_FORCE_PATH_STYLE</span>
                <button
                  type="button"
                  class="toggle"
                  :class="{ 'toggle--on': runtimeForm.s3ForcePathStyle }"
                  :aria-checked="runtimeForm.s3ForcePathStyle"
                  role="switch"
                  @click="runtimeForm.s3ForcePathStyle = !runtimeForm.s3ForcePathStyle"
                >
                  <span class="toggle__thumb" />
                </button>
              </label>
              <label class="config-field">
                <span>S3_ACCESS_KEY_ID</span>
                <input
                  v-model="runtimeForm.s3AccessKeyId"
                  class="config-input"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="t('settings.runtime.credentials.keepExisting')"
                >
              </label>
              <label class="config-field">
                <span>S3_SECRET_ACCESS_KEY</span>
                <input
                  v-model="runtimeForm.s3SecretAccessKey"
                  class="config-input"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="t('settings.runtime.credentials.keepExisting')"
                >
              </label>
              <p
                v-if="credentialStatus"
                class="runtime-note"
              >
                {{ credentialStatus }}
              </p>
            </div>
          </div>

          <div class="field-row field-row--stacked">
            <div class="field-text">
              <div class="field-label">
                {{ t('settings.runtime.imports.title') }}
              </div>
              <div class="field-hint">
                {{ t('settings.runtime.imports.description') }}
              </div>
            </div>
            <div class="config-fields config-fields--compact">
              <label class="config-field">
                <span>MUSICDL_SEARCH_TIMEOUT_MS</span>
                <input
                  v-model.number="runtimeForm.searchTimeoutMs"
                  class="config-input"
                  type="number"
                  min="1"
                >
              </label>
              <label class="config-field">
                <span>MUSICDL_DOWNLOAD_TIMEOUT_MS</span>
                <input
                  v-model.number="runtimeForm.downloadTimeoutMs"
                  class="config-input"
                  type="number"
                  min="1"
                >
              </label>
              <label class="config-field">
                <span>IMPORT_CANDIDATE_TTL_MS</span>
                <input
                  v-model.number="runtimeForm.candidateTtlMs"
                  class="config-input"
                  type="number"
                  min="1"
                >
              </label>
              <label class="config-field">
                <span>IMPORT_WORKER_POLL_MS</span>
                <input
                  v-model.number="runtimeForm.workerPollMs"
                  class="config-input"
                  type="number"
                  min="1"
                >
              </label>
            </div>
          </div>

          <div class="runtime-actions">
            <p
              v-if="runtimeSaveError"
              class="runtime-status runtime-status--error"
            >
              {{ runtimeSaveError }}
            </p>
            <p
              v-else-if="runtimeSaveSucceeded"
              class="runtime-status"
            >
              {{ runtimeRestartRequired ? t('settings.runtime.save.savedRestart') : t('settings.runtime.save.saved') }}
            </p>
            <button
              type="submit"
              class="settings-button settings-button--primary"
              :disabled="runtimeSaveDisabled"
            >
              {{ runtimeSaving ? t('settings.runtime.save.saving') : t('settings.runtime.save.action') }}
            </button>
          </div>
        </form>
      </div>
    </section>

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
  background: color-mix(in srgb, var(--bg-surface) 25%, var(--bg-base));
  border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  border-radius: 0.875rem;
  overflow: hidden;
}

.runtime-form {
  margin: 0;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.125rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  transition: opacity 180ms ease;
}

.field-row:first-child {
  border-top: none;
}

.field-row--disabled {
  opacity: 0.55;
}

.field-row--stacked {
  align-items: stretch;
  flex-direction: column;
  gap: 0.75rem;
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

.field-control--start {
  justify-content: flex-start;
  max-width: 100%;
}

.field-footnote {
  padding: 0.5rem 1.125rem 0.875rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.source-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-height: 2rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
}

.source-pill:hover {
  background: var(--bg-elevated);
}

.source-pill--active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.source-pill__icon {
  width: 1rem;
  height: 1rem;
  color: var(--text-secondary);
}

.config-list {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.config-list--compact {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.config-item {
  min-width: 0;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg-primary);
}

.config-item dt {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.config-item dd {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-primary);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.config-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.config-fields--compact {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.config-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.config-field--inline {
  min-height: 4.375rem;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg-primary);
}

.config-input {
  width: 100%;
  min-height: 2.5rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
}

.config-input:focus {
  border-color: var(--accent);
  outline: none;
}

.config-input::placeholder {
  color: var(--text-secondary);
}

.runtime-note {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.runtime-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1rem;
  padding: 0.875rem 1.125rem;
  border-top: 1px solid var(--border);
}

.runtime-status {
  margin: 0;
  flex: 1;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.runtime-status--error {
  color: #dc2626;
}

.settings-button {
  min-height: 2.25rem;
  padding: 0 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.settings-button--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.settings-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
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

  .config-list,
  .config-list--compact,
  .config-fields,
  .config-fields--compact {
    grid-template-columns: 1fr;
  }

  .runtime-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
