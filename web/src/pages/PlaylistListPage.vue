<script setup lang="ts">
import type { Playlist } from '../api/types.gen'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import PlaylistCover from '../components/PlaylistCover.vue'
import { useAuth } from '../composables/useAuth'
import { useConfirm } from '../composables/useConfirm'
import { usePlayerState } from '../composables/usePlayerState'
import { useCreatePlaylist, useDeletePlaylist, usePlaylistDetailFetcher, usePlaylistsQuery } from '../composables/usePlaylists'
import { useToast } from '../composables/useToast'

type SortKey = 'updated' | 'created' | 'nameAsc' | 'nameDesc' | 'tracks'

const { t } = useI18n()
const router = useRouter()
const { isGuest } = useAuth()
const { data: playlists, isPending, isError, error } = usePlaylistsQuery()
const createPlaylistMutation = useCreatePlaylist()
const deletePlaylistMutation = useDeletePlaylist()
const { confirm } = useConfirm()
const toast = useToast()
const nameInput = ref<HTMLInputElement | null>(null)

const search = ref('')
const sort = ref<SortKey>('updated')
const showCreate = ref(false)
const name = ref('')
const description = ref('')
const formError = ref('')

const sortOptions = computed<Array<{ value: SortKey, label: string }>>(() => [
  { value: 'updated', label: t('playlist.sortUpdatedDesc') },
  { value: 'created', label: t('playlist.sortCreatedDesc') },
  { value: 'nameAsc', label: t('playlist.sortNameAsc') },
  { value: 'nameDesc', label: t('playlist.sortNameDesc') },
  { value: 'tracks', label: t('playlist.sortTracksDesc') },
])

const filteredPlaylists = computed(() => {
  const source = playlists.value ?? []
  const keyword = search.value.trim().toLowerCase()
  const filtered = keyword
    ? source.filter((playlist) => {
        const fields = [playlist.name, playlist.description].filter(Boolean).join(' ').toLowerCase()
        return fields.includes(keyword)
      })
    : [...source]

  return filtered.sort((a, b) => {
    switch (sort.value) {
      case 'nameAsc': { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      }
      case 'nameDesc': { return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' })
      }
      case 'tracks': { return b.trackCount - a.trackCount
      }
      case 'created': { return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }
      default: { return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }
    }
  })
})

const isCreating = computed(() => createPlaylistMutation.isPending.value)

function formatDuration(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function resetCreateForm(): void {
  name.value = ''
  description.value = ''
  formError.value = ''
}

async function toggleCreate(): Promise<void> {
  showCreate.value = !showCreate.value
  if (!showCreate.value) {
    resetCreateForm()
    return
  }
  await nextTick()
  nameInput.value?.focus()
}

async function handleCreate(): Promise<void> {
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    formError.value = t('playlist.nameRequired')
    return
  }

  formError.value = ''

  try {
    const playlist = await createPlaylistMutation.mutateAsync({
      name: trimmedName,
      description: description.value.trim() || null,
    })
    resetCreateForm()
    showCreate.value = false
    router.push(`/playlists/${playlist.id}`)
  }
  catch (error_) {
    formError.value = error_ instanceof Error ? error_.message : t('playlist.createFailed')
  }
}

async function handleDelete(playlist: Playlist, event: MouseEvent): Promise<void> {
  event.stopPropagation()
  if (deletePlaylistMutation.isPending.value) {
    return
  }

  const confirmed = await confirm({
    title: t('confirm.deletePlaylistTitle', { name: playlist.name }),
    message: t('confirm.deletePlaylistMessage'),
    confirmLabel: t('confirm.delete'),
    danger: true,
  })
  if (!confirmed) {
    return
  }

  try {
    await deletePlaylistMutation.mutateAsync(playlist.id)
    toast.show({ message: t('feedback.playlistDeleted'), icon: 'i-tabler-trash' })
  }
  catch {
    toast.show({ message: t('feedback.failed'), icon: 'i-tabler-alert-circle', tone: 'danger' })
  }
}

function openPlaylist(id: string): void {
  router.push(`/playlists/${id}`)
}

const { selectTrack, setPlaying } = usePlayerState()
const fetchPlaylistDetail = usePlaylistDetailFetcher()
const startingPlaylistId = ref<string | null>(null)

async function playPlaylist(playlist: Playlist, event: MouseEvent): Promise<void> {
  event.stopPropagation()
  if (startingPlaylistId.value) {
    return
  }
  startingPlaylistId.value = playlist.id
  try {
    const detail = await fetchPlaylistDetail(playlist.id)
    const first = detail.tracks[0]
    if (!first) {
      return
    }
    selectTrack(first.id, {
      contextTracks: detail.tracks,
      context: { type: 'playlist', playlistId: playlist.id },
    })
    setPlaying(true)
  }
  catch {
    toast.show({ message: t('feedback.failed'), icon: 'i-tabler-alert-circle', tone: 'danger' })
  }
  finally {
    startingPlaylistId.value = null
  }
}
</script>

<template>
  <section class="playlists-page">
    <header class="playlists-hero">
      <div>
        <h1 class="playlists-title">
          {{ t('nav.playlists') }}
        </h1>
        <p
          v-if="playlists?.length"
          class="playlists-subtitle"
        >
          {{ t('playlist.playlistCount', { n: playlists.length }) }}
        </p>
      </div>
      <button
        v-if="!isGuest"
        type="button"
        class="playlists-new-btn"
        :disabled="isCreating"
        :aria-expanded="showCreate"
        @click="toggleCreate"
      >
        <span
          class="i-tabler-plus"
          aria-hidden="true"
        />
        <span>{{ t('playlist.newPlaylist') }}</span>
      </button>
    </header>

    <section
      v-if="showCreate"
      class="playlist-create"
    >
      <div class="playlist-create-fields">
        <input
          ref="nameInput"
          v-model="name"
          class="playlist-input"
          type="text"
          maxlength="120"
          :disabled="isCreating"
          :placeholder="t('playlist.newPlaylist')"
          :aria-label="t('playlist.newPlaylist')"
          @keydown.enter.prevent="handleCreate"
          @keydown.esc.stop.prevent="toggleCreate"
        >
        <textarea
          v-model="description"
          class="playlist-textarea"
          rows="2"
          maxlength="2000"
          :disabled="isCreating"
          :placeholder="t('playlist.descriptionPlaceholder')"
          :aria-label="t('playlist.descriptionPlaceholder')"
        />
      </div>
      <div class="playlist-create-actions">
        <button
          type="button"
          class="playlist-submit"
          :disabled="isCreating"
          @click="handleCreate"
        >
          <span
            v-if="isCreating"
            class="i-tabler-loader-2 animate-spin"
            aria-hidden="true"
          />
          <span
            v-else
            class="i-tabler-plus"
            aria-hidden="true"
          />
          <span>{{ t('common.actions.save') }}</span>
        </button>
        <button
          type="button"
          class="playlist-cancel"
          :disabled="isCreating"
          @click="toggleCreate"
        >
          {{ t('common.actions.cancel') }}
        </button>
      </div>
      <p
        v-if="formError"
        class="playlist-error"
        role="alert"
      >
        {{ formError }}
      </p>
    </section>

    <div class="playlists-toolbar">
      <div class="playlists-search">
        <span
          class="i-tabler-search playlists-search-icon"
          aria-hidden="true"
        />
        <input
          v-model="search"
          class="playlists-search-input"
          :placeholder="t('playlist.searchPlaceholder')"
          :aria-label="t('playlist.searchPlaceholder')"
          type="search"
          data-shortcut-search
          aria-keyshortcuts="/ Control+K Meta+K"
        >
        <button
          v-if="search"
          type="button"
          class="playlists-search-clear"
          :aria-label="t('common.actions.clear')"
          @click="search = ''"
        >
          <span
            class="i-tabler-x"
            aria-hidden="true"
          />
        </button>
      </div>
      <label class="playlists-sort">
        <span
          class="i-tabler-sort-descending"
          aria-hidden="true"
        />
        <select
          v-model="sort"
          class="playlists-sort-select"
          :aria-label="t('playlist.sortBy')"
        >
          <option
            v-for="option in sortOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>

    <div
      v-if="isError"
      class="playlist-empty"
      role="alert"
    >
      <span
        class="i-tabler-alert-circle playlist-empty-icon playlist-empty-icon--danger"
        aria-hidden="true"
      />
      <p class="playlist-empty-title">
        {{ t('playlist.listLoadFailed') }}
      </p>
      <p
        v-if="(error as Error)?.message"
        class="playlist-empty-hint"
      >
        {{ (error as Error).message }}
      </p>
    </div>
    <div
      v-else-if="isPending"
      class="playlist-grid"
      aria-busy="true"
    >
      <div
        v-for="index in 5"
        :key="index"
        class="playlist-card playlist-card--skeleton"
      >
        <div class="skeleton playlist-skel-cover" />
        <div class="playlist-card-body">
          <div class="skeleton playlist-skel-line playlist-skel-line--title" />
          <div class="skeleton playlist-skel-line playlist-skel-line--meta" />
        </div>
      </div>
    </div>
    <div
      v-else-if="filteredPlaylists.length === 0"
      class="playlist-empty"
    >
      <span
        class="playlist-empty-icon"
        :class="search ? 'i-tabler-search-off' : 'i-tabler-playlist'"
        aria-hidden="true"
      />
      <p class="playlist-empty-title">
        {{ search ? t('library.noResultsTitle') : t('playlist.emptyListTitle') }}
      </p>
      <p class="playlist-empty-hint">
        {{ search ? t('library.noResultsHint') : t('playlist.emptyListHint') }}
      </p>
      <button
        v-if="!search && !showCreate && !isGuest"
        type="button"
        class="playlist-empty-action"
        @click="toggleCreate"
      >
        <span
          class="i-tabler-plus"
          aria-hidden="true"
        />
        <span>{{ t('playlist.newPlaylist') }}</span>
      </button>
    </div>
    <div
      v-else
      class="playlist-grid"
    >
      <article
        v-for="playlist in filteredPlaylists"
        :key="playlist.id"
        class="playlist-card"
      >
        <div class="playlist-card-art">
          <PlaylistCover
            :urls="playlist.previewCoverUrls"
            :thumbhashes="playlist.previewCoverThumbhashes"
            size="fill"
            :rounded="false"
          />
          <button
            v-if="playlist.trackCount > 0"
            type="button"
            class="playlist-card-play"
            :aria-label="`${t('playlist.playAll')} ${playlist.name}`"
            :disabled="startingPlaylistId === playlist.id"
            @click="playPlaylist(playlist, $event)"
          >
            <span
              :class="startingPlaylistId === playlist.id ? 'i-tabler-loader-2 animate-spin' : 'i-tabler-player-play-filled'"
              aria-hidden="true"
            />
          </button>
          <button
            v-if="!isGuest"
            type="button"
            class="playlist-card-delete"
            :aria-label="t('playlist.deletePlaylist')"
            :title="t('playlist.deletePlaylist')"
            @click="handleDelete(playlist, $event)"
          >
            <span
              class="i-tabler-trash"
              aria-hidden="true"
            />
          </button>
        </div>
        <div class="playlist-card-body">
          <button
            type="button"
            class="playlist-card-main"
            @click="openPlaylist(playlist.id)"
          >
            <h2 class="playlist-card-title">
              {{ playlist.name }}
            </h2>
          </button>
          <p
            v-if="playlist.description"
            class="playlist-card-description"
          >
            {{ playlist.description }}
          </p>
          <p class="playlist-card-meta">
            <span>{{ t('playlist.trackCount', { n: playlist.trackCount }) }}</span>
            <span
              v-if="playlist.trackCount > 0"
              class="playlist-card-meta-dot"
              aria-hidden="true"
            >·</span>
            <span v-if="playlist.trackCount > 0">{{ formatDuration(playlist.totalDurationSeconds) }}</span>
          </p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.playlists-page {
  display: grid;
  gap: 1.5rem;
  padding: 1.5rem 0;
}

/* ── Hero ── */
.playlists-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.playlists-title {
  margin: 0;
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-display, inherit);
  letter-spacing: -0.025em;
  line-height: 1.1;
}

.playlists-subtitle {
  margin: 0.375rem 0 0;
  font-size: 0.875rem;
  color: var(--text-tertiary);
}

/* ── New playlist button ── */
.playlists-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  border: none;
  border-radius: 999px;
  background: var(--accent);
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
  white-space: nowrap;
}

.playlists-new-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.playlists-new-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.playlists-new-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Create form ── */
.playlist-create {
  display: grid;
  gap: 0.875rem;
  padding: 1.25rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--bg-surface);
}

.playlist-create-fields {
  display: grid;
  gap: 0.625rem;
}

.playlist-input,
.playlist-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  resize: vertical;
  font-family: inherit;
}

.playlist-input:focus,
.playlist-textarea:focus {
  outline: 2px solid color-mix(in srgb, var(--accent) 40%, transparent);
  outline-offset: -1px;
  border-color: var(--accent);
}

.playlist-create-actions {
  display: flex;
  gap: 0.5rem;
}

.playlist-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.25rem;
  padding: 0 1rem;
  border: none;
  border-radius: 999px;
  background: var(--accent);
  color: white;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}

.playlist-submit:hover:not(:disabled) {
  background: var(--accent-hover);
}

.playlist-cancel {
  display: inline-flex;
  align-items: center;
  padding: 0 1rem;
  min-height: 2.25rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 400;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.playlist-cancel:hover {
  border-color: var(--text-tertiary);
  color: var(--text-primary);
}

.playlist-error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--danger);
}

/* ── Toolbar ── */
.playlists-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
  align-items: center;
}

.playlists-search {
  position: relative;
  flex: 1;
  min-width: 12rem;
}

.playlists-search-icon {
  position: absolute;
  left: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.875rem;
  color: var(--text-tertiary);
  pointer-events: none;
}

.playlists-search-input {
  width: 100%;
  height: 2.625rem;
  padding: 0 2.75rem 0 2.5rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.playlists-search-input::placeholder {
  color: var(--text-tertiary);
}

.playlists-search-input:focus {
  background: var(--bg-elevated);
  border-color: var(--border);
}

.playlists-search-clear {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 1rem;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.playlists-search-clear:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.playlists-sort {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0 0.875rem;
  height: 2.625rem;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.75rem;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.playlists-sort:hover {
  border-color: var(--border);
}

.playlists-sort-select {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 400;
  cursor: pointer;
  outline: none;
}

/* ── Grid ── */
.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 1.5rem 1rem;
}

@media (min-width: 768px) {
  .playlist-grid {
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  }
}

/* ── Card ── */
.playlist-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.playlist-card-art {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: 0 0 0 1px var(--border);
  transition: box-shadow var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out);
}

.playlist-card:not(.playlist-card--skeleton):hover .playlist-card-art {
  transform: translateY(-2px);
  box-shadow: 0 0 0 1px var(--border-strong), 0 10px 24px rgba(0, 0, 0, 0.35);
}

.playlist-card:has(.playlist-card-main:focus-visible) .playlist-card-art {
  box-shadow: 0 0 0 2px var(--accent);
}

.playlist-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  padding: 0 0.125rem;
}

/* The title button stretches over the whole card so the card opens on click;
   play and delete sit above it. */
.playlist-card-main {
  position: static;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.playlist-card-main::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius-lg);
}

.playlist-card-main:focus-visible {
  outline: none;
}

.playlist-card-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-display, inherit);
}

.playlist-card-description {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist-card-meta {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.playlist-card-meta-dot {
  opacity: 0.6;
}

/* ── Cover actions ── */
.playlist-card-play,
.playlist-card-delete {
  position: absolute;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out), background var(--duration-fast) ease, color var(--duration-fast) ease;
}

.playlist-card-play {
  right: 0.625rem;
  bottom: 0.625rem;
  width: 2.75rem;
  height: 2.75rem;
  background: var(--accent);
  color: white;
  font-size: 1.125rem;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
}

.playlist-card-play:hover:not(:disabled) {
  background: var(--accent-hover);
  transform: scale(1.06);
}

.playlist-card-delete {
  top: 0.5rem;
  right: 0.5rem;
  width: 2rem;
  height: 2rem;
  background: rgba(0, 0, 0, 0.5);
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.9375rem;
}

.playlist-card-delete:hover,
.playlist-card-delete:focus-visible {
  background: var(--danger);
  color: white;
}

/* With a pointer, cover actions appear on hover/focus; touch keeps play visible. */
@media (hover: hover) {
  .playlist-card-play {
    opacity: 0;
    transform: translateY(0.375rem);
  }
  .playlist-card-delete {
    opacity: 0;
  }
  .playlist-card:hover .playlist-card-play,
  .playlist-card:focus-within .playlist-card-play {
    opacity: 1;
    transform: none;
  }
  .playlist-card:hover .playlist-card-delete,
  .playlist-card:focus-within .playlist-card-delete {
    opacity: 1;
  }
}

@media (hover: none) {
  .playlist-card-delete {
    display: none;
  }
}

/* ── Skeleton ── */
.playlist-card--skeleton {
  cursor: default;
}

.playlist-skel-cover {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: var(--radius-lg);
}

.playlist-skel-line {
  height: 0.75rem;
  border-radius: 0.25rem;
}

.playlist-skel-line--title {
  width: 70%;
}

.playlist-skel-line--meta {
  width: 40%;
  margin-top: 0.375rem;
}

/* ── Empty state ── */
.playlist-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 4rem 1rem;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  color: var(--text-secondary);
  text-align: center;
}

.playlist-empty-icon {
  margin-bottom: 0.5rem;
  font-size: 2rem;
  color: var(--text-tertiary);
}

.playlist-empty-icon--danger {
  color: color-mix(in srgb, var(--danger) 60%, transparent);
}

.playlist-empty-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-secondary);
  font-family: var(--font-display);
}

.playlist-empty-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.playlist-empty-action {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.5rem 1.125rem;
  border: none;
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease;
}

.playlist-empty-action:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}
</style>
