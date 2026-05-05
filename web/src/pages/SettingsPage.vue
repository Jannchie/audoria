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

interface ProviderFormEntry {
  apiKey: string
  removeApiKey: boolean
  defaultModel: string
  baseUrl: string
}

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
  defaultProvider: string
  providers: Record<string, ProviderFormEntry>
  sources: MusicDlSource[]
  urlSources: MusicDlUrlSource[]
  searchTimeoutMs: number
  downloadTimeoutMs: number
  candidateTtlMs: number
  workerPollMs: number
}

type SettingsSection = 'runtime' | 'appearance'
type ExpandedProvider = string | null

const allMusicSources: MusicDlSource[] = [
  'NeteaseMusicClient',
  'QQMusicClient',
  'KuwoMusicClient',
  'MiguMusicClient',
  'JamendoMusicClient',
]

const allUrlSources: MusicDlUrlSource[] = ['Bilibili', 'Youtube']

const knownProviders: Array<{ key: string, label: string, defaultModel: string, defaultBaseUrl: string }> = [
  { key: 'openai', label: 'OpenAI', defaultModel: 'gpt-5.4-mini', defaultBaseUrl: 'https://api.openai.com/v1' },
  { key: 'anthropic', label: 'Anthropic', defaultModel: 'claude-sonnet-4-20250514', defaultBaseUrl: 'https://api.anthropic.com/v1' },
  { key: 'google', label: 'Google (Gemini)', defaultModel: 'gemini-2.5-flash', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { key: 'groq', label: 'Groq', defaultModel: 'llama-3.3-70b-versatile', defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  { key: 'openrouter', label: 'OpenRouter', defaultModel: 'openai/gpt-4o', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  { key: 'together', label: 'Together AI', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', defaultBaseUrl: 'https://api.together.xyz/v1' },
  { key: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-v4-flash', defaultBaseUrl: 'https://api.deepseek.com/v1' },
]

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

function createDefaultProviders(): Record<string, ProviderFormEntry> {
  const entries: Record<string, ProviderFormEntry> = {}
  for (const p of knownProviders) {
    entries[p.key] = {
      apiKey: '',
      removeApiKey: false,
      defaultModel: p.defaultModel,
      baseUrl: p.defaultBaseUrl,
    }
  }
  return entries
}

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
  defaultProvider: 'openai',
  providers: createDefaultProviders(),
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
const activeSection = ref<SettingsSection>('runtime')
const expandedProvider = ref<ExpandedProvider>(null)

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

  runtimeForm.defaultProvider = config.ai.defaultProvider
  for (const p of knownProviders) {
    const providerConfig = config.ai.providers[p.key]
    if (providerConfig && runtimeForm.providers[p.key]) {
      runtimeForm.providers[p.key].apiKey = ''
      runtimeForm.providers[p.key].removeApiKey = false
      runtimeForm.providers[p.key].defaultModel = providerConfig.defaultModel ?? p.defaultModel
      runtimeForm.providers[p.key].baseUrl = providerConfig.baseUrl ?? p.defaultBaseUrl
    }
  }
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

function getProviderStatus(providerKey: string): { configured: boolean, source: 'environment' | 'settings' | null, removePending: boolean } {
  const config = appConfig.value?.ai.providers[providerKey]
  if (!config) {
    return { configured: false, source: null, removePending: false }
  }
  const entry = runtimeForm.providers[providerKey]
  return {
    configured: config.apiKeyConfigured,
    source: config.apiKeySource,
    removePending: entry?.removeApiKey ?? false,
  }
}

const providerEnvNames: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
}

function getProviderEnvName(providerKey: string): string {
  return providerEnvNames[providerKey] ?? `${providerKey.toUpperCase()}_API_KEY`
}

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

async function saveSourceConfig(previousSources: MusicDlSource[], previousUrlSources: MusicDlUrlSource[]): Promise<void> {
  runtimeSaveError.value = ''
  runtimeSaveSucceeded.value = false
  runtimeRestartRequired.value = false
  try {
    const result = await updateAppConfig.mutateAsync({
      musicdl: {
        sources: runtimeForm.sources,
        urlSources: runtimeForm.urlSources,
      },
    })
    runtimeSaveSucceeded.value = true
    runtimeRestartRequired.value = result.restartRequired
  }
  catch (error) {
    runtimeForm.sources = previousSources
    runtimeForm.urlSources = previousUrlSources
    runtimeSaveError.value = error instanceof Error ? error.message : t('settings.runtime.save.failed')
  }
}

async function toggleMusicSource(source: MusicDlSource): Promise<void> {
  const previousSources = [...runtimeForm.sources]
  const previousUrlSources = [...runtimeForm.urlSources]
  if (runtimeForm.sources.includes(source)) {
    if (runtimeForm.sources.length > 1) {
      runtimeForm.sources = runtimeForm.sources.filter(item => item !== source)
      await saveSourceConfig(previousSources, previousUrlSources)
    }
    return
  }
  runtimeForm.sources = [...runtimeForm.sources, source]
  await saveSourceConfig(previousSources, previousUrlSources)
}

async function toggleUrlSource(source: MusicDlUrlSource): Promise<void> {
  const previousSources = [...runtimeForm.sources]
  const previousUrlSources = [...runtimeForm.urlSources]
  if (runtimeForm.urlSources.includes(source)) {
    if (runtimeForm.urlSources.length > 1) {
      runtimeForm.urlSources = runtimeForm.urlSources.filter(item => item !== source)
      await saveSourceConfig(previousSources, previousUrlSources)
    }
    return
  }
  runtimeForm.urlSources = [...runtimeForm.urlSources, source]
  await saveSourceConfig(previousSources, previousUrlSources)
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.floor(Number(value) || 1))
}

function toggleProviderKeyRemoval(providerKey: string): void {
  const entry = runtimeForm.providers[providerKey]
  if (!entry) {
    return
  }
  entry.removeApiKey = !entry.removeApiKey
  if (entry.removeApiKey) {
    entry.apiKey = ''
  }
}

function buildRuntimeUpdate(): AppConfigUpdate {
  const providers: Record<string, { apiKey?: string, removeApiKey?: boolean, defaultModel?: string, baseUrl?: string | null }> = {}
  for (const p of knownProviders) {
    const entry = runtimeForm.providers[p.key]
    if (!entry) {
      continue
    }
    const update: { apiKey?: string, removeApiKey?: boolean, defaultModel?: string, baseUrl?: string | null } = {}
    if (entry.apiKey.trim()) {
      update.apiKey = entry.apiKey.trim()
    }
    if (entry.removeApiKey) {
      update.removeApiKey = true
    }
    if (entry.defaultModel !== p.defaultModel) {
      update.defaultModel = entry.defaultModel.trim()
    }
    if (entry.baseUrl !== p.defaultBaseUrl) {
      update.baseUrl = entry.baseUrl.trim() || null
    }
    if (Object.keys(update).length > 0) {
      providers[p.key] = update
    }
  }

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
    ai: {
      defaultProvider: runtimeForm.defaultProvider !== 'openai' ? runtimeForm.defaultProvider : undefined,
      providers: Object.keys(providers).length > 0 ? providers : undefined,
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

    <div class="settings-shell">
      <aside
        class="settings-sidebar"
        :aria-label="t('settings.sections.label')"
      >
        <button
          type="button"
          class="settings-tab"
          :class="{ 'settings-tab--active': activeSection === 'runtime' }"
          :aria-current="activeSection === 'runtime' ? 'page' : undefined"
          @click="activeSection = 'runtime'"
        >
          <span
            class="i-tabler-server-cog settings-tab__icon"
            aria-hidden="true"
          />
          <span>{{ t('settings.groups.runtime') }}</span>
        </button>
        <button
          type="button"
          class="settings-tab"
          :class="{ 'settings-tab--active': activeSection === 'appearance' }"
          :aria-current="activeSection === 'appearance' ? 'page' : undefined"
          @click="activeSection = 'appearance'"
        >
          <span
            class="i-tabler-palette settings-tab__icon"
            aria-hidden="true"
          />
          <span>{{ t('settings.groups.appearance') }}</span>
        </button>
      </aside>

      <main class="settings-main">
        <section
          v-if="activeSection === 'runtime'"
          class="settings-group"
        >
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
                    :disabled="runtimeSaving"
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
                    :disabled="runtimeSaving"
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

                <div class="segmented-control">
                  <button
                    type="button"
                    class="segmented-control__item"
                    :class="{ 'segmented-control__item--active': runtimeForm.storageBackend === 'fs' }"
                    :aria-pressed="runtimeForm.storageBackend === 'fs'"
                    @click="runtimeForm.storageBackend = 'fs'"
                  >
                    {{ t('settings.runtime.storage.backends.fs') }}
                  </button>
                  <button
                    type="button"
                    class="segmented-control__item"
                    :class="{ 'segmented-control__item--active': runtimeForm.storageBackend === 's3' }"
                    :aria-pressed="runtimeForm.storageBackend === 's3'"
                    @click="runtimeForm.storageBackend = 's3'"
                  >
                    {{ t('settings.runtime.storage.backends.s3') }}
                  </button>
                </div>

                <div
                  v-if="runtimeForm.storageBackend === 'fs'"
                  class="storage-fields"
                >
                  <label class="config-field">
                    <span>STORAGE_FS_ROOT</span>
                    <input
                      v-model="runtimeForm.fsRootDir"
                      class="config-input"
                      type="text"
                      autocomplete="off"
                    >
                  </label>
                </div>

                <div
                  v-else
                  class="storage-fields"
                >
                  <div class="storage-fields__section">
                    <div class="storage-fields__section-title">Connection</div>
                    <div class="storage-fields__grid">
                      <label class="config-field storage-fields__field">
                        <span>S3_BUCKET</span>
                        <input
                          v-model="runtimeForm.s3Bucket"
                          class="config-input"
                          type="text"
                          autocomplete="off"
                        >
                      </label>
                      <label class="config-field storage-fields__field">
                        <span>S3_ENDPOINT</span>
                        <input
                          v-model="runtimeForm.s3Endpoint"
                          class="config-input"
                          type="url"
                          autocomplete="off"
                        >
                      </label>
                      <label class="config-field storage-fields__field">
                        <span>S3_REGION</span>
                        <input
                          v-model="runtimeForm.s3Region"
                          class="config-input"
                          type="text"
                          autocomplete="off"
                        >
                      </label>
                      <label class="config-field storage-fields__field storage-fields__field--toggle">
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
                    </div>
                  </div>
                  <div class="storage-fields__section">
                    <div class="storage-fields__section-title">Credentials</div>
                    <div class="storage-fields__grid">
                      <label class="config-field storage-fields__field storage-fields__field--wide">
                        <span>S3_ACCESS_KEY_ID</span>
                        <input
                          v-model="runtimeForm.s3AccessKeyId"
                          class="config-input"
                          type="password"
                          autocomplete="new-password"
                          :placeholder="t('settings.runtime.credentials.keepExisting')"
                        >
                      </label>
                      <label class="config-field storage-fields__field storage-fields__field--wide">
                        <span>S3_SECRET_ACCESS_KEY</span>
                        <input
                          v-model="runtimeForm.s3SecretAccessKey"
                          class="config-input"
                          type="password"
                          autocomplete="new-password"
                          :placeholder="t('settings.runtime.credentials.keepExisting')"
                        >
                      </label>
                    </div>
                    <p
                      v-if="credentialStatus"
                      class="storage-fields__note"
                    >
                      {{ credentialStatus }}
                    </p>
                  </div>
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

              <div class="field-row field-row--stacked">
                <div class="field-text">
                  <div class="field-label">
                    {{ t('settings.runtime.ai.title') }}
                  </div>
                  <div class="field-hint">
                    {{ t('settings.runtime.ai.description') }}
                  </div>
                </div>

                <div class="ai-provider-select">
                  <label class="ai-provider-select__label">
                    {{ t('settings.runtime.ai.defaultProvider') }}
                  </label>
                  <select
                    v-model="runtimeForm.defaultProvider"
                    class="ai-provider-select__dropdown"
                  >
                    <option
                      v-for="p in knownProviders"
                      :key="p.key"
                      :value="p.key"
                    >
                      {{ p.label }}
                    </option>
                  </select>
                </div>

                <div class="ai-provider-rows">
                  <div
                    v-for="p in knownProviders"
                    :key="p.key"
                    class="ai-provider-row"
                    :class="{
                      'ai-provider-row--active': runtimeForm.defaultProvider === p.key,
                      'ai-provider-row--expanded': expandedProvider === p.key,
                    }"
                  >
                    <div
                      class="ai-provider-row__head"
                      @click="expandedProvider = expandedProvider === p.key ? null : p.key"
                    >
                      <span
                        class="ai-provider-row__indicator"
                        :class="getProviderStatus(p.key).configured || getProviderStatus(p.key).source === 'environment' ? 'ai-provider-row__indicator--on' : 'ai-provider-row__indicator--off'"
                      />
                      <span class="ai-provider-row__name">
                        {{ p.label }}
                        <span
                          v-if="runtimeForm.defaultProvider === p.key"
                          class="ai-provider-row__default-tag"
                        >{{ t('settings.runtime.ai.defaultTag') }}</span>
                      </span>
                      <span class="ai-provider-row__status">
                        <template v-if="getProviderStatus(p.key).removePending">
                          {{ t('settings.runtime.apiKeys.removePendingLabel') }}
                        </template>
                        <template v-else-if="getProviderStatus(p.key).source === 'environment'">
                          {{ t('settings.runtime.apiKeys.envBadge') }}
                        </template>
                        <template v-else-if="getProviderStatus(p.key).configured">
                          {{ t('settings.runtime.apiKeys.configuredBadge') }}
                        </template>
                        <template v-else>
                          {{ t('settings.runtime.apiKeys.missingBadge') }}
                        </template>
                      </span>
                      <span
                        class="ai-provider-row__chevron i-tabler-chevron-down"
                        :class="{ 'ai-provider-row__chevron--open': expandedProvider === p.key }"
                      />
                    </div>
                    <div
                      v-show="expandedProvider === p.key"
                      class="ai-provider-row__body"
                    >
                      <div class="ai-provider-row__fields">
                        <label class="config-field ai-provider-row__field">
                          <span>API Key</span>
                          <input
                            v-model="runtimeForm.providers[p.key].apiKey"
                            class="config-input"
                            type="password"
                            autocomplete="new-password"
                            :disabled="runtimeForm.providers[p.key].removeApiKey || getProviderStatus(p.key).source === 'environment'"
                            :placeholder="getProviderStatus(p.key).configured ? t('settings.runtime.apiKeys.keepExisting') : ''"
                          >
                        </label>
                        <label class="config-field ai-provider-row__field">
                          <span>Model</span>
                          <input
                            v-model="runtimeForm.providers[p.key].defaultModel"
                            class="config-input"
                            type="text"
                            autocomplete="off"
                            :placeholder="p.defaultModel"
                          >
                        </label>
                        <label class="config-field ai-provider-row__field">
                          <span>Base URL</span>
                          <input
                            v-model="runtimeForm.providers[p.key].baseUrl"
                            class="config-input"
                            type="url"
                            autocomplete="off"
                            :placeholder="p.defaultBaseUrl"
                          >
                        </label>
                      </div>
                      <div class="ai-provider-row__actions">
                        <button
                          v-if="getProviderStatus(p.key).configured && getProviderStatus(p.key).source !== 'environment'"
                          type="button"
                          class="settings-button"
                          @click="toggleProviderKeyRemoval(p.key)"
                        >
                          {{ runtimeForm.providers[p.key].removeApiKey ? t('settings.runtime.apiKeys.keep') : t('settings.runtime.apiKeys.remove') }}
                        </button>
                        <p
                          v-if="getProviderStatus(p.key).source === 'environment'"
                          class="ai-provider-row__note"
                        >
                          {{ t('settings.runtime.apiKeys.configuredByProvider', { env: getProviderEnvName(p.key) }) }}
                        </p>
                      </div>
                    </div>
                  </div>
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

        <template v-else>
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
        </template>
      </main>
    </div>
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

.settings-shell {
  display: grid;
  grid-template-columns: minmax(9rem, 13rem) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.settings-sidebar {
  position: sticky;
  top: 4.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.settings-tab {
  width: 100%;
  min-height: 2.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0 0.75rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
}

.settings-tab:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.settings-tab--active {
  border-color: transparent;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}

.settings-tab__icon {
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
}

.settings-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
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

.source-pill:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.source-pill--active {
  border-color: transparent;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}

.source-pill--active .source-pill__icon {
  color: var(--accent);
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

.config-input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.config-input::placeholder {
  color: var(--text-secondary);
}

.config-action-button {
  align-self: end;
  min-height: 2.5rem;
}

/* ── AI Provider Select ── */

.ai-provider-select {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.ai-provider-select__label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.ai-provider-select__dropdown {
  min-height: 2.25rem;
  min-width: 12rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='%23888' d='M5 6l3 4 3-4'/%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
  background-size: 1rem;
  padding-right: 2rem;
}

.ai-provider-select__dropdown:focus {
  border-color: var(--accent);
  outline: none;
}

/* ── Segmented control (storage backend) ── */

.segmented-control {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  overflow: hidden;
  align-self: start;
}

.segmented-control__item {
  min-height: 2.25rem;
  padding: 0 1rem;
  border: none;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.segmented-control__item + .segmented-control__item {
  border-left: 1px solid var(--border);
}

.segmented-control__item:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.segmented-control__item--active {
  background: var(--accent);
  color: #fff;
}

.segmented-control__item--active:hover {
  background: color-mix(in srgb, var(--accent) 85%, #000);
}

/* ── Storage fields ── */

.storage-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.storage-fields__section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.storage-fields__section-title {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.storage-fields__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.storage-fields__field {
  min-width: 0;
}

.storage-fields__field--wide {
  grid-column: 1 / -1;
}

.storage-fields__field--toggle {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2.5rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg-primary);
}

.storage-fields__note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* ── AI Provider Rows ── */

.ai-provider-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  overflow: hidden;
  background: var(--border);
}

.ai-provider-row {
  background: var(--bg-primary);
  overflow: hidden;
}

.ai-provider-row--active {
  background: color-mix(in srgb, var(--accent) 4%, var(--bg-primary));
}

.ai-provider-row__head {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  cursor: pointer;
  user-select: none;
  transition: background 120ms ease;
}

.ai-provider-row__head:hover {
  background: color-mix(in srgb, var(--bg-elevated) 50%, transparent);
}

.ai-provider-row__indicator {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--text-secondary);
  opacity: 0.4;
}

.ai-provider-row__indicator--on {
  background: #22c55e;
  opacity: 1;
}

.ai-provider-row__indicator--off {
  background: var(--text-secondary);
  opacity: 0.3;
}

.ai-provider-row__name {
  flex: 1;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ai-provider-row__default-tag {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.ai-provider-row__status {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.ai-provider-row__chevron {
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
  color: var(--text-secondary);
  transition: transform 180ms ease;
}

.ai-provider-row__chevron--open {
  transform: rotate(180deg);
}

.ai-provider-row__body {
  border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
}

.ai-provider-row__fields {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
  padding: 0.875rem;
}

.ai-provider-row__field {
  min-width: 0;
}

.ai-provider-row__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 0.875rem 0.75rem;
}

.ai-provider-row__note {
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
  border-color: transparent;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
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
  .settings-shell {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-sidebar {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 0.125rem;
  }

  .settings-tab {
    width: auto;
    flex: 0 0 auto;
    white-space: nowrap;
  }

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

  .ai-provider-row__fields {
    grid-template-columns: 1fr;
  }

  .ai-provider-select {
    flex-direction: column;
    align-items: stretch;
  }

  .runtime-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
