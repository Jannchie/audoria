<script setup lang="ts">
import type { MusicDlSearchResult, MusicDlSource } from '../api/types.gen'
import { useQueryClient } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'
import { useImportJobQuery, useImportMusic, useMusicQuery, useSearchMusicImport } from '../composables/useMusic'
import { formatTrackSpecs } from '../utils/audio'

const importPageStateKey = 'audoria.import-page-state'
interface PersistedImportPageState {
  searchKeyword: string
  selectedSource: MusicDlSource | null
  limitPerSource: number
  searchResults: MusicDlSearchResult[]
  activeImportResultId: string | null
  activeImportJobId: string | null
  importFormError: string
  hasSearchedOnce: boolean
}

const initialLimitPerSource = 10
const loadMoreStep = 10

function loadPersistedImportPageState(): PersistedImportPageState | null {
  try {
    const raw = globalThis.sessionStorage.getItem(importPageStateKey)
    if (!raw) {
      return null
    }
    return JSON.parse(raw) as PersistedImportPageState
  }
  catch {
    return null
  }
}

function savePersistedImportPageState(state: PersistedImportPageState): void {
  globalThis.sessionStorage.setItem(importPageStateKey, JSON.stringify(state))
}

const persistedState = loadPersistedImportPageState()

const sourceOptions: Array<{ value: MusicDlSource | null, label: string }> = [
  { value: null, label: 'All' },
  { value: 'NeteaseMusicClient', label: 'Netease' },
  { value: 'QQMusicClient', label: 'QQ' },
  { value: 'KuwoMusicClient', label: 'Kuwo' },
  { value: 'MiguMusicClient', label: 'Migu' },
  { value: 'JamendoMusicClient', label: 'Jamendo' },
]

const sourceDisplayMap = {
  NeteaseMusicClient: { label: 'Netease', icon: 'i-tabler-brand-netease-music' },
  QQMusicClient: { label: 'QQ', icon: 'i-arcticons-qq-music' },
  KuwoMusicClient: { label: 'Kuwo', icon: 'i-tabler-disc' },
  MiguMusicClient: { label: 'Migu', icon: 'i-arcticons-migu' },
  JamendoMusicClient: { label: 'Jamendo', icon: 'i-arcticons-jamendo' },
} satisfies Record<MusicDlSource, { label: string, icon: string }>

function isMusicDlSource(value: string): value is MusicDlSource {
  return value in sourceDisplayMap
}

function getSourceDisplay(source: string): { label: string, icon: string } {
  if (source in sourceDisplayMap) {
    return sourceDisplayMap[source as MusicDlSource]
  }

  return {
    label: source || 'Unknown',
    icon: 'i-tabler-world',
  }
}

const queryClient = useQueryClient()
const { data: tracks } = useMusicQuery()
const searchKeyword = ref(persistedState?.searchKeyword ?? '')
const selectedSource = ref<MusicDlSource | null>(
  persistedState?.selectedSource && isMusicDlSource(persistedState.selectedSource)
    ? persistedState.selectedSource
    : null,
)
const limitPerSource = ref(Math.max(1, persistedState?.limitPerSource ?? initialLimitPerSource))
const searchResults = ref<MusicDlSearchResult[]>(persistedState?.searchResults ?? [])
const activeImportResultId = ref<string | null>(persistedState?.activeImportResultId ?? null)
const activeImportJobId = ref<string | null>(persistedState?.activeImportJobId ?? null)
const importFormError = ref(persistedState?.importFormError ?? '')
const hasSearchedOnce = ref(persistedState?.hasSearchedOnce ?? false)
const searchMutation = useSearchMusicImport()
const importMutation = useImportMusic()
const importJobQuery = useImportJobQuery(activeImportJobId)

const isSearching = computed<boolean>(() => searchMutation.isPending.value)
const hasSearched = computed(() => hasSearchedOnce.value || searchMutation.isSuccess.value || searchResults.value.length > 0)
const isLoadingMore = computed(() => isSearching.value && hasSearched.value && searchResults.value.length > 0)
const currentImportJob = computed(() => activeImportJobId.value ? (importJobQuery.data.value ?? null) : null)
const completedTrack = computed(() => {
  const trackId = currentImportJob.value?.trackId
  if (!trackId) {
    return null
  }
  return (tracks.value ?? []).find(track => track.id === trackId) ?? null
})

const searchErrorMessage = computed(() => {
  const err = searchMutation.error.value
  if (!err) {
    return ''
  }
  return extractErrorMessage(err, 'Search failed. Please retry.')
})

const importErrorMessage = computed(() => {
  const err = importMutation.error.value
  if (!err) {
    return ''
  }
  return extractErrorMessage(err, 'Import failed.')
})

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const importProgress = computed(() => {
  const job = currentImportJob.value
  if (!job || job.status !== 'running') {
    return null
  }

  return {
    progressBytes: typeof job.progressBytes === 'number' ? job.progressBytes : 0,
    totalBytes: typeof job.totalBytes === 'number' ? job.totalBytes : null,
    progressPercent: typeof job.progressPercent === 'number' ? job.progressPercent : null,
  }
})

const importJobMessage = computed(() => {
  const job = currentImportJob.value
  if (!job) {
    return ''
  }
  if (job.status === 'queued') {
    return `Queued: ${job.songName}`
  }
  if (job.status === 'running') {
    if (importProgress.value?.progressPercent !== null && importProgress.value) {
      return `Importing: ${job.songName}... ${importProgress.value.progressPercent}%`
    }
    if (importProgress.value && importProgress.value.progressBytes > 0) {
      return `Importing: ${job.songName}... ${formatBytes(importProgress.value.progressBytes)}`
    }
    return `Importing: ${job.songName}...`
  }
  if (job.status === 'succeeded') {
    if (completedTrack.value) {
      return `Done: ${job.songName} · ${formatTrackSpecs(completedTrack.value)}`
    }
    return `Done: ${job.songName}`
  }
  return job.errorMessage || `Failed: ${job.songName}`
})

const statusMessage = computed(() => {
  if (importFormError.value) {
    return { text: importFormError.value, type: 'error' }
  }
  if (searchErrorMessage.value) {
    return { text: searchErrorMessage.value, type: 'error' }
  }
  if (importErrorMessage.value) {
    return { text: importErrorMessage.value, type: 'error' }
  }
  if (currentImportJob.value) {
    const s = currentImportJob.value.status
    return {
      text: importJobMessage.value,
      type: s === 'failed' ? 'error' : s === 'succeeded' ? 'success' : 'info',
    }
  }
  return null
})

watch(currentImportJob, (job) => {
  if (!job) {
    return
  }
  if (job.status === 'succeeded' && job.trackId) {
    queryClient.invalidateQueries({ queryKey: ['music'] }).catch(() => {})
  }
})

watch(
  [searchKeyword, selectedSource, limitPerSource, searchResults, activeImportResultId, activeImportJobId, importFormError, hasSearchedOnce],
  () => {
    savePersistedImportPageState({
      searchKeyword: searchKeyword.value,
      selectedSource: selectedSource.value,
      limitPerSource: limitPerSource.value,
      searchResults: searchResults.value,
      activeImportResultId: activeImportResultId.value,
      activeImportJobId: activeImportJobId.value,
      importFormError: importFormError.value,
      hasSearchedOnce: hasSearchedOnce.value,
    })
  },
  { deep: true },
)

function resetImportState(): void {
  activeImportResultId.value = null
  activeImportJobId.value = null
  importMutation.reset()
}

function runSearch(nextLimitPerSource: number, clearExistingResults: boolean): void {
  const keyword = searchKeyword.value.trim()
  if (!keyword) {
    importFormError.value = 'Enter a keyword to search.'
    return
  }
  importFormError.value = ''
  hasSearchedOnce.value = true
  limitPerSource.value = nextLimitPerSource
  if (clearExistingResults) {
    searchResults.value = []
    resetImportState()
  }
  searchMutation.mutate({
    keyword,
    source: selectedSource.value ?? undefined,
    limitPerSource: nextLimitPerSource,
  }, {
    onSuccess: (results) => {
      searchResults.value = results
    },
  })
}

function handleSearch(): void {
  runSearch(initialLimitPerSource, true)
}

function handleLoadMore(): void {
  if (isSearching.value) {
    return
  }
  runSearch(limitPerSource.value + loadMoreStep, false)
}

function handleImport(result: MusicDlSearchResult): void {
  if (!result.downloadable) {
    return
  }
  importFormError.value = ''
  activeImportResultId.value = result.id
  activeImportJobId.value = null
  importMutation.mutate(result.id, {
    onSuccess: (job) => {
      activeImportJobId.value = job.id
    },
    onError: () => {
      activeImportResultId.value = null
    },
  })
}

function isImporting(id: string): boolean {
  if (activeImportResultId.value !== id) {
    return false
  }
  if (importMutation.isPending.value) {
    return true
  }
  const status = currentImportJob.value?.status
  return status === 'queued' || status === 'running'
}
</script>

<template>
  <section class="import-page">
    <!-- Search bar -->
    <div class="search-area">
      <div class="search-bar">
        <span class="i-tabler-search search-bar-icon" />
        <input
          v-model="searchKeyword"
          class="search-bar-input"
          placeholder="Search songs, artists..."
          type="text"
          @keydown.enter.prevent="handleSearch"
        >
        <button
          v-if="searchKeyword"
          class="search-bar-action"
          :disabled="isSearching"
          type="button"
          @click="handleSearch"
        >
          <span
            :class="isSearching ? 'i-tabler-loader-2 animate-spin' : 'i-tabler-arrow-right'"
          />
        </button>
      </div>
      <div class="source-filter">
        <button
          v-for="option in sourceOptions"
          :key="option.label"
          type="button"
          class="source-chip"
          :class="{ 'source-chip--active': selectedSource === option.value }"
          @click="selectedSource = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <!-- Status -->
      <div
        v-if="statusMessage"
        class="status-pill"
        :class="{
          'status-pill--error': statusMessage.type === 'error',
          'status-pill--success': statusMessage.type === 'success',
          'status-pill--info': statusMessage.type === 'info',
        }"
      >
        {{ statusMessage.text }}
      </div>
      <div
        v-if="importProgress"
        class="progress-block"
      >
        <div class="progress-track">
          <div
            class="progress-fill"
            :class="{ 'progress-fill--indeterminate': importProgress.progressPercent === null }"
            :style="{ width: `${importProgress.progressPercent ?? 35}%` }"
          />
        </div>
        <p class="progress-text">
          <template v-if="importProgress.totalBytes">
            {{ formatBytes(importProgress.progressBytes) }} / {{ formatBytes(importProgress.totalBytes) }}
          </template>
          <template v-else>
            {{ formatBytes(importProgress.progressBytes) }}
          </template>
        </p>
      </div>
    </div>

    <!-- Idle state: before any search -->
    <div
      v-if="!isSearching && !hasSearched"
      class="idle-state"
    >
      <span class="i-tabler-world-search text-4xl text-[var(--text-tertiary)]/30" />
      <p class="idle-text">
        Search across multiple music sources
      </p>
    </div>

    <!-- Loading -->
    <div
      v-else-if="isSearching"
      class="result-list"
    >
      <div
        v-for="i in 6"
        :key="i"
        class="result-row"
      >
        <div class="skeleton result-cover-skel" />
        <div class="flex-1 space-y-1.5">
          <div
            class="skeleton rounded h-3.5"
            :style="{ width: `${100 + Math.random() * 100}px` }"
          />
          <div
            class="skeleton rounded h-3"
            :style="{ width: `${60 + Math.random() * 60}px` }"
          />
        </div>
      </div>
    </div>

    <!-- Results -->
    <div
      v-else-if="searchResults.length > 0"
      class="result-list"
    >
      <button
        v-for="result in searchResults"
        :key="result.id"
        type="button"
        class="result-row"
        :class="{
          'result-row--importing': isImporting(result.id),
          'result-row--disabled': !result.downloadable,
        }"
        :disabled="isImporting(result.id) || !result.downloadable"
        @click="handleImport(result)"
      >
        <div class="result-cover">
          <img
            v-if="result.coverUrl"
            :src="result.coverUrl"
            :alt="result.songName"
            class="result-cover-img"
          >
          <span
            v-else
            class="i-tabler-music result-cover-icon"
          />
        </div>

        <div class="result-meta">
          <p class="result-name">
            {{ result.songName }}
          </p>
          <p class="result-sub">
            {{ result.singers }}
            <template v-if="result.album">
              · {{ result.album }}
            </template>
          </p>
        </div>

        <div class="result-right">
          <span class="result-source">
            <span
              class="result-source-icon"
              :class="getSourceDisplay(result.source).icon"
            />
            <span class="result-source-label">{{ getSourceDisplay(result.source).label }}</span>
          </span>
          <span
            v-if="isImporting(result.id)"
            class="i-tabler-loader-2 text-base text-[var(--accent)] animate-spin"
          />
          <span
            v-else-if="result.downloadable"
            class="i-tabler-download result-dl-icon text-base"
          />
          <span
            v-else
            class="text-[10px] text-[var(--text-tertiary)]"
          >N/A</span>
        </div>
      </button>
      <button
        type="button"
        class="load-more-btn"
        :disabled="isSearching"
        @click="handleLoadMore"
      >
        <span
          v-if="isLoadingMore"
          class="i-tabler-loader-2 animate-spin"
        />
        <span
          v-else
          class="i-tabler-plus"
        />
        {{ isLoadingMore ? 'Loading more...' : `Load more (${limitPerSource + loadMoreStep} per source)` }}
      </button>
    </div>

    <!-- No results -->
    <div
      v-else-if="searchMutation.isSuccess.value"
      class="idle-state"
    >
      <span class="i-tabler-mood-empty text-4xl text-[var(--text-tertiary)]/30" />
      <p class="idle-text">
        No results found
      </p>
    </div>
  </section>
</template>

<style scoped>
.import-page {
  padding-top: 0.75rem;
}

@media (min-width: 768px) {
  .import-page {
    padding-top: 0;
  }
}

/* ---- Search ---- */
.search-area {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
  background: var(--bg-base);
  margin-bottom: 0.5rem;
}

@media (min-width: 768px) {
  .search-area {
    top: 3.5rem;
    padding: 0.75rem 0 0.5rem;
  }
}

.search-bar {
  display: flex;
  align-items: center;
  height: 2.75rem;
  border-radius: 1.375rem;
  background: var(--bg-surface);
  padding: 0 0.5rem 0 0;
  transition: background 0.15s ease;
  position: relative;
}

.search-bar:focus-within {
  background: var(--bg-elevated);
}

.search-bar-icon {
  position: absolute;
  left: 0.875rem;
  font-size: 0.875rem;
  color: var(--text-tertiary);
  pointer-events: none;
}

.search-bar-input {
  flex: 1;
  height: 100%;
  padding: 0 0.5rem 0 2.5rem;
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.search-bar-input::placeholder {
  color: var(--text-tertiary);
}

.search-bar-action {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.search-bar-action:hover {
  background: var(--accent-hover);
}

.source-filter {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.125rem;
  scrollbar-width: none;
}

.source-filter::-webkit-scrollbar {
  display: none;
}

.source-chip {
  flex-shrink: 0;
  border: none;
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-tertiary);
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.source-chip:hover {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.source-chip--active {
  background: var(--accent-soft);
  color: var(--accent);
}

.status-pill {
  font-size: 0.75rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.5rem;
  text-align: center;
}

.status-pill--error {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.08);
}

.status-pill--success {
  color: var(--success);
  background: rgba(52, 211, 153, 0.08);
}

.status-pill--info {
  color: var(--accent);
  background: var(--accent-soft);
}

.progress-block {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.progress-track {
  width: 100%;
  height: 0.25rem;
  border-radius: 999px;
  background: var(--bg-elevated);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.2s ease;
}

.progress-fill--indeterminate {
  animation: progress-pulse 1.2s ease-in-out infinite;
}

.progress-text {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

@keyframes progress-pulse {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 1;
  }
}

/* ---- Idle state ---- */
.idle-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 5rem 1rem;
  text-align: center;
}

.idle-text {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  margin-top: 0.75rem;
}

/* ---- Result list ---- */
.result-list {
  display: flex;
  flex-direction: column;
}

.load-more-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-height: 2.5rem;
  margin-top: 0.75rem;
  border: none;
  border-radius: 0.75rem;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.load-more-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  border-radius: 0.75rem;
  transition: background 0.15s ease;
  cursor: pointer;
  border: none;
  background: none;
  text-align: left;
  width: 100%;
}

.result-row:hover {
  background: var(--bg-surface);
}

.result-row--importing {
  background: var(--accent-soft);
}

.result-row--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.result-cover {
  width: 3rem;
  height: 3rem;
  border-radius: 0.5rem;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-cover-skel {
  width: 3rem;
  height: 3rem;
  border-radius: 0.5rem;
  flex-shrink: 0;
}

.result-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.result-cover-icon {
  color: var(--text-tertiary);
}

.result-meta {
  flex: 1;
  min-width: 0;
}

.result-name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
}

.result-sub {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 0.125rem;
}

.result-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.result-source {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--text-tertiary);
}

.result-source-icon {
  font-size: 0.875rem;
}

.result-source-label {
  display: none;
  font-size: 0.625rem;
}

@media (min-width: 640px) {
  .result-source-label {
    display: inline;
  }
}

.result-dl-icon {
  color: var(--text-tertiary);
  transition: color 0.15s ease;
}

.result-row:hover .result-dl-icon {
  color: var(--accent);
}
</style>
