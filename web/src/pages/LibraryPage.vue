<script setup lang="ts">
import type { Music } from '../api/types.gen'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AddToPlaylistDialog from '../components/AddToPlaylistDialog.vue'
import MetadataEditDialog from '../components/MetadataEditDialog.vue'
import SoundWave from '../components/SoundWave.vue'
import SourceBadge from '../components/SourceBadge.vue'
import { resolveApiUrl, useDeleteMusic, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'
import { formatTrackSpecs } from '../utils/audio'

const librarySearchStateKey = 'audoria.library-search'
const skeletonTitleWidths = [72, 56, 80, 48, 68, 60, 76, 52]
const skeletonMetaWidths = [38, 30, 44, 26, 40, 34, 48, 32]

const { t } = useI18n()
const { data: tracks, isPending, isError, error } = useMusicQuery()
const deleteMutation = useDeleteMusic()
const { currentTrackId, isPlaying, selectTrack, setPlaying } = usePlayerState()

const search = ref(globalThis.sessionStorage.getItem(librarySearchStateKey) ?? '')

watch(search, (value) => {
  globalThis.sessionStorage.setItem(librarySearchStateKey, value)
})

const filteredTracks = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  const list = tracks.value ?? []
  if (!keyword) {
    return list
  }
  return list.filter((item) => {
    const searchable = [item.filename, item.title, item.artists, item.album]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return searchable.includes(keyword)
  })
})

function handleTrackClick(id: string): void {
  if (currentTrackId.value === id) {
    setPlaying(!isPlaying.value)
  }
  else {
    selectTrack(id, { contextTracks: tracks.value ?? [] })
    setPlaying(true)
  }
}

function trackCoverUrl(track: Music): string {
  const coverUrl = track.coverThumbUrl ?? track.coverUrl
  return coverUrl ? resolveApiUrl(coverUrl) : ''
}

function isDeleting(id: string): boolean {
  return deleteMutation.isPending.value && deleteMutation.variables.value === id
}

const editingTrack = ref<Music | null>(null)
const isEditOpen = computed(() => editingTrack.value !== null)
const playlistTrack = ref<Music | null>(null)
const isPlaylistDialogOpen = computed(() => playlistTrack.value !== null)

function openEdit(track: Music, event: MouseEvent): void {
  event.stopPropagation()
  editingTrack.value = track
}

function closeEdit(): void {
  editingTrack.value = null
}

function openPlaylistDialog(track: Music, event: MouseEvent): void {
  event.stopPropagation()
  playlistTrack.value = track
}

function closePlaylistDialog(): void {
  playlistTrack.value = null
}

async function handleDelete(id: string): Promise<void> {
  if (isDeleting(id)) {
    return
  }

  await deleteMutation.mutateAsync(id)

  if (currentTrackId.value === id) {
    setPlaying(false)
    selectTrack(null, { history: 'skip' })
  }
}
</script>

<template>
  <section class="library">
    <!-- Search bar -->
    <div class="search-wrapper">
      <span class="i-tabler-search search-icon" />
      <input
        v-model="search"
        class="search-input"
        :placeholder="t('library.searchPlaceholder')"
        type="search"
      >
    </div>

    <!-- Error -->
    <div
      v-if="isError"
      class="empty-state"
    >
      <span class="i-tabler-alert-circle text-3xl text-[var(--danger)]/50" />
      <p class="empty-text">
        {{ (error as Error)?.message ?? t('library.loadFailed') }}
      </p>
    </div>

    <!-- Loading -->
    <template v-else-if="isPending">
      <div class="track-list">
        <div
          v-for="i in 8"
          :key="i"
          class="track-row"
        >
          <div class="skeleton track-cover-skeleton" />
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
    </template>

    <!-- Empty -->
    <div
      v-else-if="filteredTracks.length === 0"
      class="empty-state"
    >
      <span class="i-tabler-music-off text-4xl text-[var(--text-tertiary)]/40" />
      <p class="empty-title">
        {{ search ? t('library.noResultsTitle') : t('library.emptyTitle') }}
      </p>
      <p class="empty-hint">
        {{ search ? t('library.noResultsHint') : t('library.emptyHint') }}
      </p>
    </div>

    <!-- Track list -->
    <div
      v-else
      class="track-list"
    >
      <button
        v-for="track in filteredTracks"
        :key="track.id"
        type="button"
        class="track-row"
        :class="{ 'track-row--active': currentTrackId === track.id }"
        :aria-label="currentTrackId === track.id && isPlaying ? t('library.pauseTrack', { title: track.title || track.filename }) : t('library.playTrack', { title: track.title || track.filename })"
        :aria-current="currentTrackId === track.id ? 'true' : undefined"
        @click="handleTrackClick(track.id)"
      >
        <div class="track-cover">
          <img
            v-if="track.coverUrl"
            :src="trackCoverUrl(track)"
            :alt="track.title || track.filename"
            class="track-cover-img"
            width="52"
            height="52"
            loading="lazy"
            decoding="async"
          >
          <span
            v-else
            class="i-tabler-music track-cover-placeholder"
            aria-hidden="true"
          />
          <!-- Play overlay on hover -->
          <div
            class="track-cover-overlay"
            aria-hidden="true"
          >
            <span
              v-if="currentTrackId === track.id && isPlaying"
              class="i-tabler-player-pause-filled"
            />
            <span
              v-else
              class="i-tabler-player-play-filled"
            />
          </div>
        </div>

        <div class="track-meta">
          <p
            class="track-name"
            :class="{ 'track-name--active': currentTrackId === track.id }"
          >
            {{ track.title || track.filename }}
          </p>
          <p class="track-sub">
            <template v-if="track.artists">
              {{ track.artists }}
              <template v-if="track.album">
                · {{ track.album }}
              </template>
            </template>
            <template v-else>
              {{ track.filename }}
            </template>
          </p>
          <p class="track-sub track-sub--secondary">
            <SourceBadge
              v-if="track.source"
              :source="track.source"
              size="xs"
              class="track-source"
            />
            <span>{{ formatTrackSpecs(track) }}</span>
          </p>
        </div>

        <div class="track-right">
          <SoundWave
            v-if="currentTrackId === track.id"
            :playing="isPlaying"
          />
          <span
            v-else-if="track.durationText"
            class="track-duration"
          >
            {{ track.durationText }}
          </span>
          <button
            type="button"
            class="track-action"
            aria-label="Add to playlist"
            @click="openPlaylistDialog(track, $event)"
          >
            <span
              class="i-tabler-playlist-add"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="track-action"
            :aria-label="t('common.actions.editMetadata')"
            @click="openEdit(track, $event)"
          >
            <span
              class="i-tabler-edit"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="track-action track-action--danger"
            :disabled="isDeleting(track.id)"
            :aria-label="isDeleting(track.id) ? t('common.actions.deletingTrack') : t('common.actions.deleteTrack')"
            @click.stop="handleDelete(track.id)"
          >
            <span
              v-if="isDeleting(track.id)"
              class="i-tabler-loader-2 animate-spin"
              aria-hidden="true"
            />
            <span
              v-else
              class="i-tabler-trash"
              aria-hidden="true"
            />
          </button>
        </div>
      </button>
    </div>

    <MetadataEditDialog
      :open="isEditOpen"
      :track="editingTrack"
      @close="closeEdit"
    />

    <AddToPlaylistDialog
      :open="isPlaylistDialogOpen"
      :track="playlistTrack"
      @close="closePlaylistDialog"
    />
  </section>
</template>

<style scoped>
.library {
  padding-top: 0.75rem;
}

@media (min-width: 768px) {
  .library {
    padding-top: 0;
  }
}

/* ---- Search ---- */
.search-wrapper {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 0.5rem 0;
  background: var(--bg-base);
}

@media (min-width: 768px) {
  .search-wrapper {
    top: 3.5rem;
    padding: 0.75rem 0 0.5rem;
  }
}

.search-icon {
  position: absolute;
  left: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.875rem;
  color: var(--text-tertiary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 2.75rem;
  padding: 0 1rem 0 2.5rem;
  border: none;
  border-radius: 1.375rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
  transition: background 0.15s ease;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.search-input:focus {
  background: var(--bg-elevated);
}

/* ---- Track list ---- */
.track-list {
  display: flex;
  flex-direction: column;
}

.track-row {
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

.track-row:hover {
  background: var(--bg-surface);
}

.track-row--active {
  background: var(--accent-soft);
}

.track-cover {
  position: relative;
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

@media (min-width: 768px) {
  .track-cover {
    width: 3.25rem;
    height: 3.25rem;
  }
}

.track-cover-skeleton {
  width: 3rem;
  height: 3rem;
  border-radius: 0.5rem;
  flex-shrink: 0;
}

@media (min-width: 768px) {
  .track-cover-skeleton {
    width: 3.25rem;
    height: 3.25rem;
  }
}

.track-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.track-cover-placeholder {
  font-size: 1rem;
  color: var(--text-tertiary);
}

.track-cover-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: white;
  font-size: 1rem;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.track-row:hover .track-cover-overlay {
  opacity: 1;
}

.track-meta {
  flex: 1;
  min-width: 0;
}

.track-name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
  font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
}

.track-name--active {
  color: var(--accent);
}

.track-sub {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 0.125rem;
}

.track-sub--secondary {
  opacity: 0.8;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.track-source {
  flex-shrink: 0;
}

.track-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.track-duration {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.track-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.track-action:hover:enabled {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.track-action--danger:hover:enabled {
  color: var(--danger);
}

.track-action:disabled {
  cursor: default;
  opacity: 0.6;
}

/* Empty state uses shared .empty-state classes from style.css */
</style>
