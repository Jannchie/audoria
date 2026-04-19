<script setup lang="ts">
import type { MusicDlSearchResult, MusicDlSource } from '../api/types.gen'
import { useQueryClient } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SourceBadge from '../components/SourceBadge.vue'
import { useImportJobQuery, useImportMusic, useMusicQuery, useSearchMusicImport } from '../composables/useMusic'
import { formatTrackSpecs } from '../utils/audio'
import { isKnownSource } from '../utils/source'

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
const skeletonTitleWidths = [70, 55, 80, 48, 66, 60]
const skeletonMetaWidths = [38, 30, 44, 26, 40, 34]

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

function isMusicDlSource(value: string): value is MusicDlSource {
  return isKnownSource(value)
}

const queryClient = useQueryClient()
const { data: tracks } = useMusicQuery()
const { t } = useI18n()
const sourceOptions = computed<Array<{ value: MusicDlSource | null, label: string }>>(() => [
  { value: null, label: t('import.allSources') },
  { value: 'NeteaseMusicClient', label: 'Netease' },
  { value: 'QQMusicClient', label: 'QQ' },
  { value: 'KuwoMusicClient', label: 'Kuwo' },
  { value: 'MiguMusicClient', label: 'Migu' },
  { value: 'JamendoMusicClient', label: 'Jamendo' },
])
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
const pendingImports = ref<Set<string>>(new Set())
const searchMutation = useSearchMusicImport()
const importMutation = useImportMusic()
const importJobQuery = useImportJobQuery(activeImportJobId)
type LibraryMatchState = 'confirmed' | 'possible' | null

function normalizePart(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replaceAll(/[()[\]{}（）【】]/g, ' ')
    .replaceAll(/[^a-z0-9\u4E00-\u9FFF]+/g, '')
}

function splitArtistTokens(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/[,/&、，；;|]| feat\. | ft\. | featuring /i)
    .map(part => normalizePart(part))
    .filter(Boolean)
}

function parseDurationSeconds(value: string | null | undefined): number | null {
  if (!value || value === '-') {
    return null
  }

  const parts = value.split(':').map(Number)
  if (parts.length < 2 || parts.some(part => Number.isNaN(part) || part < 0)) {
    return null
  }

  return parts.reduce((total, part) => total * 60 + part, 0)
}

function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function buildExactMatchKey(source: string | null | undefined, identifier: string | null | undefined): string {
  const normalizedSource = normalizePart(source)
  const normalizedIdentifier = normalizeIdentifier(identifier)
  if (!normalizedSource || !normalizedIdentifier) {
    return ''
  }
  return `${normalizedSource}|${normalizedIdentifier}`
}

const exactLibraryTrackKeys = computed<Set<string>>(() => {
  const set = new Set<string>()
  for (const track of tracks.value ?? []) {
    const key = buildExactMatchKey(track.source, track.sourceIdentifier)
    if (key) {
      set.add(key)
    }
  }
  return set
})

const libraryMatches = computed(() => {
  const items: Array<{
    title: string
    artists: string[]
    album: string
    durationSeconds: number | null
  }> = []
  for (const track of tracks.value ?? []) {
    const title = normalizePart(track.title)
    const artists = splitArtistTokens(track.artists)
    if (!title || artists.length === 0) {
      continue
    }
    items.push({
      title,
      artists,
      album: normalizePart(track.album),
      durationSeconds: track.durationSeconds,
    })
  }
  return items
})

function getLibraryMatchState(result: MusicDlSearchResult): LibraryMatchState {
  const exactMatchKey = buildExactMatchKey(result.source, result.sourceIdentifier)
  if (exactMatchKey && exactLibraryTrackKeys.value.has(exactMatchKey)) {
    return 'confirmed'
  }

  const title = normalizePart(result.songName)
  const artists = splitArtistTokens(result.singers)
  if (!title || artists.length === 0) {
    return null
  }

  const album = normalizePart(result.album)
  const durationSeconds = parseDurationSeconds(result.duration)
  let hasPossibleMatch = false

  for (const track of libraryMatches.value) {
    if (track.title !== title) {
      continue
    }

    const sharesArtist = artists.some(artist => track.artists.includes(artist))
    if (!sharesArtist) {
      continue
    }

    if (album && track.album && album !== track.album) {
      continue
    }

    if (
      durationSeconds !== null
      && track.durationSeconds !== null
      && Math.abs(durationSeconds - track.durationSeconds) > 3
    ) {
      continue
    }

    const hasAlbumEvidence = Boolean(album && track.album)
    const hasDurationEvidence = durationSeconds !== null && track.durationSeconds !== null

    if (hasAlbumEvidence || hasDurationEvidence) {
      return 'confirmed'
    }

    hasPossibleMatch = true
  }

  return hasPossibleMatch ? 'possible' : null
}

function isAlreadyImported(result: MusicDlSearchResult): boolean {
  return getLibraryMatchState(result) === 'confirmed'
}

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
  return extractErrorMessage(err, t('import.searchFailed'))
})

const importErrorMessage = computed(() => {
  const err = importMutation.error.value
  if (!err) {
    return ''
  }
  return extractErrorMessage(err, t('import.importFailed'))
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
    return t('import.status.queued', { song: job.songName })
  }
  if (job.status === 'running') {
    if (importProgress.value?.progressPercent !== null && importProgress.value) {
      return t('import.status.importingPercent', { song: job.songName, percent: importProgress.value.progressPercent })
    }
    if (importProgress.value && importProgress.value.progressBytes > 0) {
      return t('import.status.importingBytes', { song: job.songName, bytes: formatBytes(importProgress.value.progressBytes) })
    }
    return t('import.status.importing', { song: job.songName })
  }
  if (job.status === 'succeeded') {
    if (completedTrack.value) {
      return t('import.status.doneWithSpec', { song: job.songName, spec: formatTrackSpecs(completedTrack.value) })
    }
    return t('import.status.done', { song: job.songName })
  }
  return job.errorMessage || t('import.status.failed', { song: job.songName })
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
  if (pendingImports.value.size > 1) {
    return { text: t('import.status.multiple', { count: pendingImports.value.size }), type: 'info' }
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
  if (job.status === 'failed' && activeImportResultId.value) {
    markPending(activeImportResultId.value, false)
  }
})

watch(tracks, () => {
  if (pendingImports.value.size === 0) {
    return
  }
  const next = new Set(pendingImports.value)
  let changed = false
  for (const id of pendingImports.value) {
    const result = searchResults.value.find(r => r.id === id)
    if (result && isAlreadyImported(result)) {
      next.delete(id)
      changed = true
    }
  }
  if (changed) {
    pendingImports.value = next
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
    importFormError.value = t('import.enterKeyword')
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

function markPending(id: string, pending: boolean): void {
  const next = new Set(pendingImports.value)
  if (pending) {
    next.add(id)
  }
  else {
    next.delete(id)
  }
  pendingImports.value = next
}

function handleImport(result: MusicDlSearchResult): void {
  if (!result.downloadable || isAlreadyImported(result) || pendingImports.value.has(result.id)) {
    return
  }
  importFormError.value = ''
  activeImportResultId.value = result.id
  activeImportJobId.value = null
  markPending(result.id, true)
  importMutation.mutate(result.id, {
    onSuccess: (job) => {
      if (activeImportResultId.value === result.id) {
        activeImportJobId.value = job.id
      }
    },
    onError: () => {
      markPending(result.id, false)
      if (activeImportResultId.value === result.id) {
        activeImportResultId.value = null
      }
    },
  })
}

function isImporting(id: string): boolean {
  return pendingImports.value.has(id)
}
</script>

<template>
  <section class="import-page">
    <!-- Search bar -->
    <div class="search-area">
      <div class="search-bar">
        <span
          class="i-tabler-search search-bar-icon"
          aria-hidden="true"
        />
        <input
          v-model="searchKeyword"
          class="search-bar-input"
          :placeholder="t('import.searchPlaceholder')"
          type="text"
          :aria-label="t('import.searchLabel')"
          @keydown.enter.prevent="handleSearch"
        >
        <button
          v-if="searchKeyword"
          class="search-bar-action"
          :disabled="isSearching"
          type="button"
          :aria-label="isSearching ? t('common.actions.searching') : t('common.actions.search')"
          @click="handleSearch"
        >
          <span
            :class="isSearching ? 'i-tabler-loader-2 animate-spin' : 'i-tabler-arrow-right'"
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        class="source-filter"
        role="group"
        :aria-label="t('import.sourceFilter')"
      >
        <button
          v-for="option in sourceOptions"
          :key="option.value ?? 'all'"
          type="button"
          class="source-chip"
          :class="{ 'source-chip--active': selectedSource === option.value }"
          :aria-pressed="selectedSource === option.value"
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
        role="status"
        aria-live="polite"
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
      class="empty-state"
    >
      <span class="i-tabler-world-search text-4xl text-[var(--text-tertiary)]/30" />
      <p class="empty-text">
        {{ t('import.emptyText') }}
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
            :style="{ width: `${skeletonTitleWidths[i % skeletonTitleWidths.length]}%` }"
          />
          <div
            class="skeleton rounded h-3"
            :style="{ width: `${skeletonMetaWidths[i % skeletonMetaWidths.length]}%` }"
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
          'result-row--imported': isAlreadyImported(result),
          'result-row--possible': getLibraryMatchState(result) === 'possible',
        }"
        :disabled="isImporting(result.id) || !result.downloadable || isAlreadyImported(result)"
        :title="isAlreadyImported(result) ? t('import.titleAlreadyInLibrary') : getLibraryMatchState(result) === 'possible' ? t('import.titlePossibleMatch') : undefined"
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
          <SourceBadge
            :source="result.source"
            class="result-source"
          />
          <span
            v-if="isImporting(result.id)"
            class="result-badge result-badge--importing"
          >
            <span class="i-tabler-loader-2 text-sm animate-spin" />
            <span>{{ t('import.badges.importing') }}</span>
          </span>
          <span
            v-else-if="isAlreadyImported(result)"
            class="result-badge result-badge--imported"
          >
            <span class="i-tabler-check text-sm" />
            <span>{{ t('import.badges.inLibrary') }}</span>
          </span>
          <span
            v-else-if="getLibraryMatchState(result) === 'possible'"
            class="result-badge result-badge--possible"
          >
            <span class="i-tabler-alert-circle text-sm" />
            <span>{{ t('import.badges.possibleMatch') }}</span>
          </span>
          <span
            v-else-if="result.downloadable"
            class="result-badge result-badge--download"
          >
            <span class="i-tabler-download text-sm" />
            <span>{{ t('import.badges.download') }}</span>
          </span>
          <span
            v-else
            class="result-badge result-badge--unavailable"
          >
            <span class="i-tabler-ban text-sm" />
            <span>{{ t('import.badges.unavailable') }}</span>
          </span>
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
        {{ isLoadingMore ? t('import.loadingMore') : t('import.loadMore', { count: limitPerSource + loadMoreStep }) }}
      </button>
    </div>

    <!-- No results -->
    <div
      v-else-if="searchMutation.isSuccess.value"
      class="empty-state"
    >
      <span class="i-tabler-mood-empty text-4xl text-[var(--text-tertiary)]/30" />
      <p class="empty-text">
        {{ t('import.noResults') }}
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
  background: var(--danger-soft);
}

.status-pill--success {
  color: var(--success);
  background: var(--success-soft);
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

/* Idle state uses shared .empty-state classes from style.css */

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

.result-row--imported {
  cursor: default;
  opacity: 0.7;
}

.result-row--imported:hover {
  background: var(--bg-surface);
}

.result-row--possible {
  background: var(--warning-soft);
}

.result-row--possible:hover {
  background: var(--warning-soft);
}

.result-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-width: 6.25rem;
  padding: 0.3rem 0.625rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}

.result-badge--download {
  color: var(--text-tertiary);
  background: var(--bg-elevated);
}

.result-row:hover .result-badge--download {
  color: var(--accent);
  background: var(--accent-soft);
}

.result-badge--imported {
  color: var(--success);
  background: var(--success-soft);
}

.result-badge--importing {
  color: var(--accent);
  background: var(--accent-soft);
}

.result-badge--possible {
  color: var(--warning);
  background: var(--warning-soft);
}

.result-badge--unavailable {
  color: var(--text-tertiary);
  background: var(--bg-elevated);
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
  color: var(--text-tertiary);
}

.result-source :deep(.source-badge__label) {
  display: none;
}

@media (min-width: 640px) {
  .result-source :deep(.source-badge__label) {
    display: inline;
  }
}
</style>
