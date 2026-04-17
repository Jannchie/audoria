<script setup lang="ts">
import type { MusicDlSearchResult } from '../api/types.gen'
import { useQueryClient } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'
import { useImportJobQuery, useImportMusic, useMusicQuery, useParseMusicUrl } from '../composables/useMusic'
import { formatTrackSpecs } from '../utils/audio'

interface PersistedState {
  url: string
  parsedResult: MusicDlSearchResult | null
  activeJobId: string | null
  parseError: string
  importError: string
}

const stateKey = 'audoria.parse-page-state'

function loadState(): PersistedState | null {
  try {
    const raw = globalThis.sessionStorage.getItem(stateKey)
    if (!raw) {
      return null
    }
    return JSON.parse(raw) as PersistedState
  }
  catch {
    return null
  }
}

function saveState(state: PersistedState): void {
  globalThis.sessionStorage.setItem(stateKey, JSON.stringify(state))
}

const persisted = loadState()
const queryClient = useQueryClient()
const { data: tracks } = useMusicQuery()

const url = ref(persisted?.url ?? '')
const parsedResult = ref<MusicDlSearchResult | null>(persisted?.parsedResult ?? null)
const activeJobId = ref<string | null>(persisted?.activeJobId ?? null)
const parseError = ref(persisted?.parseError ?? '')
const importError = ref(persisted?.importError ?? '')

const parseMutation = useParseMusicUrl()
const importMutation = useImportMusic()
const importJobQuery = useImportJobQuery(activeJobId)

const isParsing = computed(() => parseMutation.isPending.value)
const isImporting = computed(() =>
  importMutation.isPending.value
  || (activeJobId.value !== null
    && (importJobQuery.data.value?.status === 'queued'
      || importJobQuery.data.value?.status === 'running')),
)

const currentJob = computed(() => activeJobId.value ? importJobQuery.data.value ?? null : null)

const completedTrack = computed(() => {
  const trackId = currentJob.value?.trackId
  if (!trackId) {
    return null
  }
  return (tracks.value ?? []).find(t => t.id === trackId) ?? null
})

function sourceDisplay(source: string | null | undefined): { label: string, icon: string } {
  if (source === 'Bilibili') {
    return { label: 'Bilibili', icon: 'i-tabler-brand-bilibili' }
  }
  if (source === 'Youtube') {
    return { label: 'YouTube', icon: 'i-tabler-brand-youtube' }
  }
  return { label: source || 'Unknown', icon: 'i-tabler-world' }
}

const detectedSource = computed<'Bilibili' | 'Youtube' | null>(() => {
  const raw = url.value.trim()
  if (!raw) {
    return null
  }
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    if (host === 'youtu.be' || host.endsWith('youtube.com')) {
      return 'Youtube'
    }
    if (host.endsWith('bilibili.com')) {
      return 'Bilibili'
    }
  }
  catch {}
  return null
})

const canParse = computed(() => Boolean(url.value.trim()) && !isParsing.value)

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
  const job = currentJob.value
  if (!job || job.status !== 'running') {
    return null
  }
  return {
    progressBytes: job.progressBytes ?? 0,
    totalBytes: job.totalBytes,
    progressPercent: job.progressPercent,
  }
})

const importStatusText = computed(() => {
  const job = currentJob.value
  if (!job) {
    return ''
  }
  if (job.status === 'queued') {
    return `Queued: ${job.songName}`
  }
  if (job.status === 'running') {
    if (importProgress.value?.progressPercent != null) {
      return `Downloading… ${importProgress.value.progressPercent}%`
    }
    if (importProgress.value && importProgress.value.progressBytes > 0) {
      return `Downloading… ${formatBytes(importProgress.value.progressBytes)}`
    }
    return 'Downloading…'
  }
  if (job.status === 'succeeded') {
    if (completedTrack.value) {
      return `Done · ${formatTrackSpecs(completedTrack.value)}`
    }
    return 'Done'
  }
  return job.errorMessage || 'Failed'
})

const statusMessage = computed<{ text: string, type: 'error' | 'success' | 'info' } | null>(() => {
  if (parseError.value) {
    return { text: parseError.value, type: 'error' }
  }
  if (importError.value) {
    return { text: importError.value, type: 'error' }
  }
  if (!currentJob.value) {
    return null
  }
  const s = currentJob.value.status
  return {
    text: importStatusText.value,
    type: s === 'failed' ? 'error' : s === 'succeeded' ? 'success' : 'info',
  }
})

function handleParse(): void {
  const raw = url.value.trim()
  if (!raw) {
    return
  }
  parseError.value = ''
  importError.value = ''
  parsedResult.value = null
  activeJobId.value = null
  parseMutation.mutate(raw, {
    onSuccess: (result) => {
      parsedResult.value = result
    },
    onError: (err) => {
      parseError.value = err instanceof Error ? err.message : 'Parse failed'
    },
  })
}

function handleImport(): void {
  const result = parsedResult.value
  if (!result) {
    return
  }
  importError.value = ''
  activeJobId.value = null
  importMutation.mutate(result.id, {
    onSuccess: (job) => {
      activeJobId.value = job.id
    },
    onError: (err) => {
      importError.value = err instanceof Error ? err.message : 'Import failed'
    },
  })
}

function handleReset(): void {
  url.value = ''
  parsedResult.value = null
  activeJobId.value = null
  parseError.value = ''
  importError.value = ''
}

watch(currentJob, (job) => {
  if (!job) {
    return
  }
  if (job.status === 'succeeded' && job.trackId) {
    queryClient.invalidateQueries({ queryKey: ['music'] }).catch(() => {})
  }
})

watch(
  [url, parsedResult, activeJobId, parseError, importError],
  () => {
    saveState({
      url: url.value,
      parsedResult: parsedResult.value,
      activeJobId: activeJobId.value,
      parseError: parseError.value,
      importError: importError.value,
    })
  },
  { deep: true },
)
</script>

<template>
  <section class="parse-page">
    <!-- URL input -->
    <div class="parse-bar-wrapper">
      <div class="parse-bar">
        <span
          class="i-tabler-link parse-bar-icon"
          aria-hidden="true"
        />
        <input
          v-model="url"
          class="parse-bar-input"
          type="url"
          placeholder="Paste a Bilibili or YouTube URL"
          aria-label="Bilibili or YouTube URL"
          @keydown.enter.prevent="handleParse"
        >
        <span
          v-if="detectedSource"
          class="parse-source-hint"
          :class="[sourceDisplay(detectedSource).icon]"
          :aria-label="sourceDisplay(detectedSource).label"
        />
        <button
          v-if="url"
          type="button"
          class="parse-bar-action"
          :disabled="!canParse"
          :aria-label="isParsing ? 'Parsing' : 'Parse URL'"
          @click="handleParse"
        >
          <span
            :class="isParsing ? 'i-tabler-loader-2 animate-spin' : 'i-tabler-arrow-right'"
            aria-hidden="true"
          />
        </button>
      </div>

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
    </div>

    <!-- Parsed card -->
    <div
      v-if="parsedResult"
      class="preview-card"
    >
      <div class="preview-cover">
        <img
          v-if="parsedResult.coverUrl"
          :src="parsedResult.coverUrl"
          :alt="parsedResult.songName"
          class="preview-cover-img"
          referrerpolicy="no-referrer"
        >
        <span
          v-else
          class="i-tabler-music preview-cover-icon"
          aria-hidden="true"
        />
      </div>
      <div class="preview-meta">
        <p class="preview-title">
          {{ parsedResult.songName }}
        </p>
        <p class="preview-sub">
          {{ parsedResult.singers || 'Unknown uploader' }}
        </p>
        <div class="preview-tags">
          <span class="preview-tag">
            <span
              class="preview-tag-icon"
              :class="sourceDisplay(parsedResult.source).icon"
              aria-hidden="true"
            />
            {{ sourceDisplay(parsedResult.source).label }}
          </span>
          <span
            v-if="parsedResult.duration && parsedResult.duration !== '-'"
            class="preview-tag"
          >
            <span
              class="i-tabler-clock preview-tag-icon"
              aria-hidden="true"
            />
            {{ parsedResult.duration }}
          </span>
          <span
            v-if="parsedResult.ext && parsedResult.ext !== 'audio'"
            class="preview-tag"
          >{{ parsedResult.ext.toUpperCase() }}</span>
        </div>
      </div>
      <div class="preview-actions">
        <button
          type="button"
          class="btn-ghost"
          :disabled="isImporting"
          @click="handleReset"
        >
          <span
            class="i-tabler-x"
            aria-hidden="true"
          />
          Reset
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="!parsedResult.downloadable || isImporting"
          @click="handleImport"
        >
          <span
            v-if="isImporting"
            class="i-tabler-loader-2 animate-spin"
            aria-hidden="true"
          />
          <span
            v-else
            class="i-tabler-download"
            aria-hidden="true"
          />
          {{ isImporting ? 'Downloading…' : 'Download' }}
        </button>
      </div>
    </div>

    <!-- Idle -->
    <div
      v-else-if="!isParsing"
      class="empty-state"
    >
      <span
        class="i-tabler-link text-4xl text-[var(--text-tertiary)]/30"
        aria-hidden="true"
      />
      <p class="empty-title">
        Parse from URL
      </p>
      <p class="empty-text">
        Paste a Bilibili or YouTube link to extract its audio.
      </p>
      <ul class="empty-hints">
        <li>
          <span
            class="i-tabler-brand-bilibili"
            aria-hidden="true"
          />
          https://www.bilibili.com/video/BVxxxxx
        </li>
        <li>
          <span
            class="i-tabler-brand-youtube"
            aria-hidden="true"
          />
          https://youtu.be/xxxxxxxxxxx
        </li>
      </ul>
    </div>

    <!-- Parsing skeleton -->
    <div
      v-else
      class="preview-card preview-card--skeleton"
    >
      <div class="skeleton preview-cover preview-cover--skel" />
      <div class="preview-meta">
        <div class="skeleton rounded h-4 w-48" />
        <div class="skeleton mt-2 rounded h-3 w-32" />
        <div class="mt-3 flex gap-2">
          <div class="skeleton rounded-full h-5 w-14" />
          <div class="skeleton rounded-full h-5 w-12" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.parse-page {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-top: 0.75rem;
}

.parse-bar-wrapper {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
  background: var(--bg-base);
}

@media (min-width: 768px) {
  .parse-bar-wrapper {
    top: 3.5rem;
    padding: 0.75rem 0 0.5rem;
  }
}

.parse-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.75rem;
  padding: 0 0.5rem 0 1rem;
  border-radius: 1.375rem;
  background: var(--bg-surface);
  transition: background 0.15s ease;
}

.parse-bar:focus-within {
  background: var(--bg-elevated);
}

.parse-bar-icon {
  font-size: 1rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.parse-bar-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: inherit;
}

.parse-bar-input::placeholder {
  color: var(--text-tertiary);
}

.parse-source-hint {
  font-size: 1.125rem;
  color: var(--accent);
  flex-shrink: 0;
}

.parse-bar-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: 999px;
  background: var(--accent);
  color: white;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.parse-bar-action:hover {
  background: var(--accent-hover);
}

.parse-bar-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.preview-card {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border-radius: 1rem;
  background: var(--bg-surface);
  align-items: center;
}

@media (min-width: 768px) {
  .preview-card {
    padding: 1.25rem;
    gap: 1.25rem;
  }
}

.preview-cover {
  width: 6rem;
  height: 6rem;
  flex-shrink: 0;
  border-radius: 0.75rem;
  overflow: hidden;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (min-width: 768px) {
  .preview-cover {
    width: 7rem;
    height: 7rem;
  }
}

.preview-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-cover-icon {
  font-size: 2rem;
  color: var(--text-tertiary);
}

.preview-cover--skel {
  animation-delay: 0s;
}

.preview-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.preview-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.preview-sub {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.625rem;
}

.preview-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.preview-tag-icon {
  font-size: 0.875rem;
}

.preview-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-shrink: 0;
}

.btn-ghost,
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-height: 2.75rem;
  padding: 0 1rem;
  border-radius: 0.75rem;
  border: none;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
  transition: background 0.15s ease, opacity 0.15s ease;
  font-family: inherit;
}

.btn-ghost {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.btn-ghost:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-primary:disabled,
.btn-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty-hints {
  list-style: none;
  padding: 0;
  margin: 1.25rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.empty-hints li {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}
</style>
