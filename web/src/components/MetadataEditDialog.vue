<script setup lang="ts">
import type { Music } from '../api/types.gen'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isLrcFormat } from '../composables/useLyrics'
import { resolveApiUrl, useDeleteCover, useUpdateCover, useUpdateMusic } from '../composables/useMusic'
import { getSourceDisplay } from '../utils/source'
import LazyCoverImage from './LazyCoverImage.vue'

const props = defineProps<{
  open: boolean
  track: Music | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'saved', track: Music): void
}>()

const updateMutation = useUpdateMusic()
const coverMutation = useUpdateCover()
const deleteCoverMutation = useDeleteCover()
const { t } = useI18n()

const title = ref('')
const artists = ref('')
const album = ref('')
const source = ref('')
const lyrics = ref('')
const error = ref('')

const pendingCoverFile = ref<File | null>(null)
const pendingCoverPreview = ref<string | null>(null)
const removeCoverPending = ref(false)

const sourcePresets: string[] = [
  'NeteaseMusicClient',
  'QQMusicClient',
  'KuwoMusicClient',
  'MiguMusicClient',
  'JamendoMusicClient',
  'Bilibili',
  'Youtube',
]

const lyricsMode = computed<'lrc' | 'plain' | 'empty'>(() => {
  const raw = lyrics.value.trim()
  if (!raw) {
    return 'empty'
  }
  return isLrcFormat(raw) ? 'lrc' : 'plain'
})

const existingCoverUrl = computed(() => {
  if (!props.track?.coverUrl) {
    return ''
  }
  return resolveApiUrl(props.track.coverUrl)
})

const displayCoverUrl = computed(() => {
  if (pendingCoverPreview.value) {
    return pendingCoverPreview.value
  }
  if (removeCoverPending.value) {
    return ''
  }
  return existingCoverUrl.value
})

const displayCoverThumbhash = computed(() =>
  pendingCoverPreview.value || removeCoverPending.value ? null : props.track?.coverThumbhash,
)

const isSaving = computed(() =>
  updateMutation.isPending.value
  || coverMutation.isPending.value
  || deleteCoverMutation.isPending.value,
)

watch(() => props.track, (track) => {
  if (!track) {
    return
  }
  title.value = track.title ?? ''
  artists.value = track.artists ?? ''
  album.value = track.album ?? ''
  source.value = track.source ?? ''
  lyrics.value = track.lyrics ?? ''
  error.value = ''
  resetPendingCover()
}, { immediate: true })

watch(() => props.open, (open) => {
  if (!open) {
    resetPendingCover()
    error.value = ''
  }
})

function resetPendingCover(): void {
  if (pendingCoverPreview.value) {
    URL.revokeObjectURL(pendingCoverPreview.value)
  }
  pendingCoverFile.value = null
  pendingCoverPreview.value = null
  removeCoverPending.value = false
}

function handleCoverPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (!file) {
    return
  }
  if (pendingCoverPreview.value) {
    URL.revokeObjectURL(pendingCoverPreview.value)
  }
  pendingCoverFile.value = file
  pendingCoverPreview.value = URL.createObjectURL(file)
  removeCoverPending.value = false
  input.value = ''
}

function handleRemoveCover(): void {
  if (pendingCoverPreview.value) {
    URL.revokeObjectURL(pendingCoverPreview.value)
  }
  pendingCoverFile.value = null
  pendingCoverPreview.value = null
  removeCoverPending.value = true
}

function handleUndoRemove(): void {
  removeCoverPending.value = false
}

function handleClose(): void {
  if (isSaving.value) {
    return
  }
  emit('close')
}

function handleBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    handleClose()
  }
}

async function handleSave(): Promise<void> {
  if (!props.track || isSaving.value) {
    return
  }
  error.value = ''
  const id = props.track.id
  try {
    const patch = {
      title: title.value.trim() || null,
      artists: artists.value.trim() || null,
      album: album.value.trim() || null,
      source: source.value.trim() || null,
      lyrics: lyrics.value.trim() ? lyrics.value : null,
    }
    let latest = await updateMutation.mutateAsync({ id, patch })
    if (pendingCoverFile.value) {
      latest = await coverMutation.mutateAsync({ id, file: pendingCoverFile.value })
    }
    else if (removeCoverPending.value && props.track.coverUrl) {
      latest = await deleteCoverMutation.mutateAsync(id)
    }
    emit('saved', latest)
    emit('close')
  }
  catch (error_) {
    error.value = error_ instanceof Error ? error_.message : t('metadata.saveFailed')
  }
}

function applySourcePreset(value: string): void {
  source.value = value
}
</script>

<template>
  <Teleport to="body">
    <Transition name="metadata-fade">
      <div
        v-if="open && track"
        class="metadata-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-dialog-title"
        @mousedown="handleBackdropClick"
      >
        <div
          class="metadata-panel"
          @mousedown.stop
        >
          <header class="metadata-header">
            <h2
              id="metadata-dialog-title"
              class="metadata-title"
            >
              {{ t('metadata.title') }}
            </h2>
            <button
              type="button"
              class="metadata-close"
              :aria-label="t('common.actions.close')"
              :disabled="isSaving"
              @click="handleClose"
            >
              <span
                class="i-tabler-x"
                aria-hidden="true"
              />
            </button>
          </header>

          <div class="metadata-body">
            <section class="metadata-cover-section">
              <div class="metadata-cover">
                <LazyCoverImage
                  v-if="displayCoverUrl"
                  :src="displayCoverUrl"
                  :alt="t('metadata.coverPreview')"
                  :thumbhash="displayCoverThumbhash"
                  loading="eager"
                />
                <span
                  v-else
                  class="i-tabler-music metadata-cover-placeholder"
                  aria-hidden="true"
                />
              </div>
              <div class="metadata-cover-actions">
                <label class="metadata-btn metadata-btn--secondary">
                  <span
                    class="i-tabler-upload"
                    aria-hidden="true"
                  />
                  <span>{{ t('common.actions.chooseImage') }}</span>
                  <input
                    class="sr-only"
                    type="file"
                    accept="image/*"
                    :disabled="isSaving"
                    @change="handleCoverPick"
                  >
                </label>
                <button
                  v-if="!removeCoverPending && (pendingCoverFile || track.coverUrl)"
                  type="button"
                  class="metadata-btn metadata-btn--ghost"
                  :disabled="isSaving"
                  @click="handleRemoveCover"
                >
                  <span
                    class="i-tabler-trash"
                    aria-hidden="true"
                  />
                  <span>{{ t('common.actions.remove') }}</span>
                </button>
                <button
                  v-if="removeCoverPending"
                  type="button"
                  class="metadata-btn metadata-btn--ghost"
                  :disabled="isSaving"
                  @click="handleUndoRemove"
                >
                  <span
                    class="i-tabler-arrow-back-up"
                    aria-hidden="true"
                  />
                  <span>{{ t('common.actions.keepCurrent') }}</span>
                </button>
                <p
                  v-if="removeCoverPending"
                  class="metadata-hint metadata-hint--warn"
                >
                  {{ t('metadata.coverWillBeRemoved') }}
                </p>
              </div>
            </section>

            <div class="metadata-fields">
              <label class="metadata-field">
                <span class="metadata-label">{{ t('metadata.fields.title') }}</span>
                <input
                  v-model="title"
                  class="metadata-input"
                  type="text"
                  :placeholder="t('metadata.placeholders.title')"
                  :disabled="isSaving"
                >
              </label>
              <label class="metadata-field">
                <span class="metadata-label">{{ t('metadata.fields.artists') }}</span>
                <input
                  v-model="artists"
                  class="metadata-input"
                  type="text"
                  :placeholder="t('metadata.placeholders.artists')"
                  :disabled="isSaving"
                >
              </label>
              <label class="metadata-field">
                <span class="metadata-label">{{ t('metadata.fields.album') }}</span>
                <input
                  v-model="album"
                  class="metadata-input"
                  type="text"
                  :placeholder="t('metadata.placeholders.album')"
                  :disabled="isSaving"
                >
              </label>
              <div class="metadata-field">
                <span class="metadata-label">{{ t('metadata.fields.source') }}</span>
                <input
                  v-model="source"
                  class="metadata-input"
                  type="text"
                  :placeholder="t('metadata.placeholders.source')"
                  :disabled="isSaving"
                >
                <div class="metadata-source-presets">
                  <button
                    v-for="preset in sourcePresets"
                    :key="preset"
                    type="button"
                    class="metadata-chip"
                    :class="{ 'metadata-chip--active': source === preset }"
                    :title="getSourceDisplay(preset).label"
                    :aria-label="getSourceDisplay(preset).label"
                    :disabled="isSaving"
                    @click="applySourcePreset(preset)"
                  >
                    <span
                      class="metadata-chip-icon"
                      :class="getSourceDisplay(preset).icon"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    class="metadata-chip"
                    :class="{ 'metadata-chip--active': source === '' }"
                    :title="t('metadata.sourceNone')"
                    :aria-label="t('metadata.sourceNone')"
                    :disabled="isSaving"
                    @click="applySourcePreset('')"
                  >
                    <span
                      class="i-tabler-x"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
              <div class="metadata-field">
                <div class="metadata-label-row">
                  <span class="metadata-label">{{ t('metadata.fields.lyrics') }}</span>
                  <span
                    class="metadata-mode-tag"
                    :data-mode="lyricsMode"
                  >
                    <template v-if="lyricsMode === 'lrc'">{{ t('metadata.lyricsModes.synced') }}</template>
                    <template v-else-if="lyricsMode === 'plain'">{{ t('metadata.lyricsModes.plain') }}</template>
                    <template v-else>{{ t('metadata.lyricsModes.empty') }}</template>
                  </span>
                </div>
                <textarea
                  v-model="lyrics"
                  class="metadata-textarea"
                  rows="10"
                  :placeholder="t('metadata.placeholders.lyrics')"
                  :disabled="isSaving"
                />
                <p class="metadata-hint">
                  {{ t('metadata.lyricsHint') }}
                </p>
              </div>
            </div>
          </div>

          <footer class="metadata-footer">
            <p
              v-if="error"
              class="metadata-error"
              role="alert"
            >
              {{ error }}
            </p>
            <div class="metadata-footer-actions">
              <button
                type="button"
                class="metadata-btn metadata-btn--ghost"
                :disabled="isSaving"
                @click="handleClose"
              >
                {{ t('common.actions.cancel') }}
              </button>
              <button
                type="button"
                class="metadata-btn metadata-btn--primary"
                :disabled="isSaving"
                @click="handleSave"
              >
                <span
                  v-if="isSaving"
                  class="i-tabler-loader-2 animate-spin"
                  aria-hidden="true"
                />
                <span>{{ isSaving ? t('common.actions.saving') : t('common.actions.save') }}</span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.metadata-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.metadata-panel {
  width: min(720px, 100%);
  max-height: calc(100vh - 2rem);
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 1rem;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.metadata-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
}

.metadata-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.metadata-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.metadata-close:hover:enabled {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.metadata-body {
  padding: 1rem 1.25rem;
  overflow-y: auto;
  display: grid;
  gap: 1.25rem;
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 640px) {
  .metadata-body {
    grid-template-columns: 180px minmax(0, 1fr);
  }
}

.metadata-cover-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
}

@media (min-width: 640px) {
  .metadata-cover-section {
    align-items: stretch;
  }
}

.metadata-cover {
  width: 180px;
  height: 180px;
  border-radius: 0.75rem;
  overflow: hidden;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
}

.metadata-cover-placeholder {
  font-size: 2.25rem;
  color: var(--text-tertiary);
}

.metadata-cover-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 180px;
}

.metadata-fields {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  min-width: 0;
}

.metadata-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
}

.metadata-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.metadata-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.metadata-mode-tag {
  font-size: 0.6875rem;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-tertiary);
}

.metadata-mode-tag[data-mode='lrc'] {
  background: var(--accent-soft);
  color: var(--accent);
}

.metadata-input,
.metadata-textarea {
  width: 100%;
  padding: 0.625rem 0.75rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid transparent;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
  font-family: inherit;
}

.metadata-input:focus,
.metadata-textarea:focus {
  background: var(--bg-elevated);
  border-color: var(--accent);
}

.metadata-textarea {
  resize: vertical;
  min-height: 10rem;
  line-height: 1.6;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.metadata-hint {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin: 0;
}

.metadata-hint--warn {
  color: var(--danger);
}

.metadata-source-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.125rem;
}

.metadata-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  font-size: 0.75rem;
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.metadata-chip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  color: currentColor;
  font-size: 0.9rem;
  line-height: 1;
}

.metadata-chip:hover:enabled {
  background: var(--bg-elevated);
}

.metadata-chip--active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.metadata-chip:disabled {
  opacity: 0.5;
  cursor: default;
}

.metadata-footer {
  padding: 0.875rem 1.25rem;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.metadata-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.metadata-error {
  font-size: 0.8125rem;
  color: var(--danger);
  margin: 0;
}

.metadata-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.5rem 0.875rem;
  border-radius: 0.5rem;
  border: 1px solid transparent;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.metadata-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.metadata-btn--primary {
  background: var(--accent);
  color: white;
}

.metadata-btn--primary:hover:enabled {
  filter: brightness(1.05);
}

.metadata-btn--secondary {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.metadata-btn--secondary:hover:enabled {
  background: var(--bg-elevated);
}

.metadata-btn--ghost {
  background: transparent;
  color: var(--text-secondary);
}

.metadata-btn--ghost:hover:enabled {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.metadata-fade-enter-active,
.metadata-fade-leave-active {
  transition: opacity 0.15s ease;
}

.metadata-fade-enter-from,
.metadata-fade-leave-to {
  opacity: 0;
}
</style>
