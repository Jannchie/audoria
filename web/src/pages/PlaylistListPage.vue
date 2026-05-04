<script setup lang="ts">
import type { Playlist } from '../api/types.gen'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import PlaylistCover from '../components/PlaylistCover.vue'
import { useCreatePlaylist, useDeletePlaylist, usePlaylistsQuery } from '../composables/usePlaylists'

type SortKey = 'updated' | 'created' | 'nameAsc' | 'nameDesc' | 'tracks'

const { t } = useI18n()
const router = useRouter()
const { data: playlists, isPending, isError, error } = usePlaylistsQuery()
const createPlaylistMutation = useCreatePlaylist()
const deletePlaylistMutation = useDeletePlaylist()

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

function toggleCreate(): void {
  showCreate.value = !showCreate.value
  if (!showCreate.value) {
    resetCreateForm()
  }
}

async function handleCreate(): Promise<void> {
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    formError.value = 'Playlist name is required.'
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
    formError.value = error_ instanceof Error ? error_.message : 'Failed to create playlist.'
  }
}

async function handleDelete(playlist: Playlist, event: MouseEvent): Promise<void> {
  event.stopPropagation()
  if (deletePlaylistMutation.isPending.value) {
    return
  }

  await deletePlaylistMutation.mutateAsync(playlist.id)
}

function openPlaylist(id: string): void {
  router.push(`/playlists/${id}`)
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
          {{ playlists.length }}
        </p>
      </div>
      <button
        type="button"
        class="playlists-new-btn"
        :disabled="isCreating"
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
          v-model="name"
          class="playlist-input"
          type="text"
          maxlength="120"
          :disabled="isCreating"
          :placeholder="t('playlist.newPlaylist')"
        >
        <textarea
          v-model="description"
          class="playlist-textarea"
          rows="2"
          maxlength="2000"
          :disabled="isCreating"
          :placeholder="t('metadata.placeholders.title')"
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
          type="search"
        >
      </div>
      <label class="playlists-sort">
        <span class="i-tabler-sort-descending" />
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
    >
      {{ (error as Error)?.message ?? 'Failed to load playlists.' }}
    </div>
    <div
      v-else-if="isPending"
      class="playlist-grid"
    >
      <div
        v-for="index in 4"
        :key="index"
        class="playlist-card playlist-card--skeleton"
      />
    </div>
    <div
      v-else-if="filteredPlaylists.length === 0"
      class="playlist-empty"
    >
      <span v-if="search">{{ t('library.noResultsTitle') }}</span>
      <span v-else>{{ t('playlist.newPlaylist') }}</span>
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
        <button
          type="button"
          class="playlist-card-main"
          @click="openPlaylist(playlist.id)"
        >
          <PlaylistCover
            :urls="playlist.previewCoverUrls"
            :thumbhashes="playlist.previewCoverThumbhashes"
            size="md"
          />
          <div class="playlist-card-body">
            <h2 class="playlist-card-title">
              {{ playlist.name }}
            </h2>
            <p
              v-if="playlist.description"
              class="playlist-card-description"
            >
              {{ playlist.description }}
            </p>
            <div class="playlist-card-meta">
              <span>{{ t('playlist.trackCount', { n: playlist.trackCount }) }}</span>
              <span class="playlist-card-meta-dot">·</span>
              <span>{{ formatDuration(playlist.totalDurationSeconds) }}</span>
            </div>
          </div>
        </button>
        <button
          type="button"
          class="playlist-card-delete"
          :aria-label="t('playlist.deletePlaylist')"
          @click="handleDelete(playlist, $event)"
        >
          <span
            class="i-tabler-trash"
            aria-hidden="true"
          />
        </button>
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
  font-weight: 800;
  color: var(--text-primary);
  font-family: var(--font-display, inherit);
  letter-spacing: -0.025em;
  line-height: 1.1;
}

.playlists-subtitle {
  display: inline-block;
  margin: 0.5rem 0 0;
  padding: 0.125rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  background: var(--bg-surface);
  border-radius: 999px;
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
  font-weight: 600;
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
  font-weight: 600;
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
  font-weight: 500;
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
  padding: 0 1rem 0 2.5rem;
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
  font-weight: 500;
  cursor: pointer;
  outline: none;
}

/* ── Grid ── */
.playlist-grid {
  display: grid;
  gap: 0.75rem;
}

@media (min-width: 768px) {
  .playlist-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* ── Card ── */
.playlist-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  background: var(--bg-surface);
  cursor: pointer;
}

.playlist-card--skeleton {
  min-height: 5.75rem;
  cursor: default;
}

.playlist-card-main {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.playlist-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  flex: 1;
}

.playlist-card-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-display, inherit);
  letter-spacing: -0.01em;
}

.playlist-card-description {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.playlist-card-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.125rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
}

.playlist-card-meta-dot {
  color: var(--text-tertiary);
  opacity: 0.4;
}

/* ── Delete button ── */
.playlist-card-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--text-tertiary);
  font-size: 1rem;
  transition: background 0.15s ease, color 0.15s ease;
  cursor: pointer;
}

.playlist-card-delete:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

/* ── Empty state ── */
.playlist-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 4rem 1rem;
  border: none;
  border-radius: 0.875rem;
  background: var(--bg-surface);
  font-size: 0.875rem;
  color: var(--text-secondary);
}
</style>
