<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SoundWave from '../components/SoundWave.vue'
import { usePlayerState } from '../composables/usePlayerState'
import {
  useDeletePlaylist,
  usePlaylistDetailQuery,
  useRemoveTrackFromPlaylist,
  useReorderPlaylistTracks,
  useUpdatePlaylist,
} from '../composables/usePlaylists'

const route = useRoute()
const router = useRouter()
const playlistId = computed(() => {
  const value = route.params.id
  return typeof value === 'string' ? value : null
})

const playlistQuery = usePlaylistDetailQuery(playlistId)
const updatePlaylistMutation = useUpdatePlaylist()
const deletePlaylistMutation = useDeletePlaylist()
const removeTrackMutation = useRemoveTrackFromPlaylist()
const reorderMutation = useReorderPlaylistTracks()
const {
  currentTrackId,
  isPlaying,
  playbackContext,
  selectTrack,
  setPlaying,
  syncTrackContext,
} = usePlayerState()

const name = ref('')
const description = ref('')
const formError = ref('')

const playlist = computed(() => playlistQuery.data.value ?? null)
const tracks = computed(() => playlist.value?.tracks ?? [])
const isCurrentPlaylistContext = computed(() =>
  playbackContext.value?.type === 'playlist'
  && playbackContext.value.playlistId === playlistId.value,
)

watch(playlist, (value) => {
  name.value = value?.name ?? ''
  description.value = value?.description ?? ''
}, { immediate: true })

watch(playlist, (value) => {
  if (!value || !playlistId.value || !isCurrentPlaylistContext.value) {
    return
  }
  syncTrackContext(value.tracks, { type: 'playlist', playlistId: playlistId.value })
}, { immediate: true })

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`
  }
  return `${remainingMinutes}m`
}

function isTrackActive(trackId: string): boolean {
  return currentTrackId.value === trackId && isCurrentPlaylistContext.value
}

function playTrack(trackId: string): void {
  if (!playlist.value || !playlistId.value) {
    return
  }

  if (isTrackActive(trackId)) {
    setPlaying(!isPlaying.value)
    return
  }

  selectTrack(trackId, {
    contextTracks: playlist.value.tracks,
    context: { type: 'playlist', playlistId: playlistId.value },
  })
  setPlaying(true)
}

function playAll(): void {
  const firstTrackId = tracks.value[0]?.id
  if (!firstTrackId || !playlistId.value) {
    return
  }

  selectTrack(firstTrackId, {
    contextTracks: tracks.value,
    context: { type: 'playlist', playlistId: playlistId.value },
  })
  setPlaying(true)
}

async function savePlaylist(): Promise<void> {
  if (!playlistId.value) {
    return
  }

  const trimmedName = name.value.trim()
  if (!trimmedName) {
    formError.value = 'Playlist name is required.'
    return
  }

  formError.value = ''

  try {
    const updated = await updatePlaylistMutation.mutateAsync({
      id: playlistId.value,
      name: trimmedName,
      description: description.value.trim() || null,
    })
    if (isCurrentPlaylistContext.value) {
      syncTrackContext(updated.tracks, { type: 'playlist', playlistId: updated.id })
    }
  }
  catch (error_) {
    formError.value = error_ instanceof Error ? error_.message : 'Failed to update playlist.'
  }
}

async function removeTrack(trackId: string): Promise<void> {
  if (!playlistId.value) {
    return
  }

  const updated = await removeTrackMutation.mutateAsync({
    playlistId: playlistId.value,
    trackId,
  })

  if (isCurrentPlaylistContext.value) {
    syncTrackContext(updated.tracks, { type: 'playlist', playlistId: updated.id })
  }
}

async function moveTrack(trackId: string, direction: 'up' | 'down'): Promise<void> {
  if (!playlistId.value || tracks.value.length < 2) {
    return
  }

  const currentIndex = tracks.value.findIndex(track => track.id === trackId)
  if (currentIndex === -1) {
    return
  }

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (targetIndex < 0 || targetIndex >= tracks.value.length) {
    return
  }

  const nextTrackIds = tracks.value.map(track => track.id)
  const [current] = nextTrackIds.splice(currentIndex, 1)
  nextTrackIds.splice(targetIndex, 0, current)

  const updated = await reorderMutation.mutateAsync({
    playlistId: playlistId.value,
    trackIds: nextTrackIds,
  })

  if (isCurrentPlaylistContext.value) {
    syncTrackContext(updated.tracks, { type: 'playlist', playlistId: updated.id })
  }
}

async function handleDeletePlaylist(): Promise<void> {
  if (!playlistId.value) {
    return
  }

  await deletePlaylistMutation.mutateAsync(playlistId.value)

  if (isCurrentPlaylistContext.value) {
    selectTrack(null, {
      contextTracks: [],
      context: { type: 'library' },
      history: 'skip',
    })
  }

  router.push('/playlists')
}

function goToLibrary(): void {
  router.push('/library')
}
</script>

<template>
  <section class="playlist-detail-page">
    <div
      v-if="playlistQuery.isError.value"
      class="playlist-detail-empty"
    >
      {{ (playlistQuery.error.value as Error)?.message ?? 'Failed to load playlist.' }}
    </div>

    <template v-else-if="playlist">
      <header class="playlist-detail-header">
        <div class="playlist-detail-fields">
          <label class="playlist-detail-label">
            <span>Name</span>
            <input
              v-model="name"
              class="playlist-detail-input"
              type="text"
              maxlength="120"
              :disabled="updatePlaylistMutation.isPending.value"
            >
          </label>
          <label class="playlist-detail-label">
            <span>Description</span>
            <textarea
              v-model="description"
              class="playlist-detail-textarea"
              rows="3"
              maxlength="2000"
              :disabled="updatePlaylistMutation.isPending.value"
            />
          </label>
        </div>

        <div class="playlist-detail-actions">
          <div class="playlist-detail-stats">
            <span>{{ playlist.trackCount }} tracks</span>
            <span>{{ formatDuration(playlist.totalDurationSeconds) }}</span>
          </div>
          <div class="playlist-detail-buttons">
            <button
              type="button"
              class="playlist-detail-button playlist-detail-button--primary"
              :disabled="!tracks.length"
              @click="playAll"
            >
              <span
                class="i-tabler-player-play"
                aria-hidden="true"
              />
              <span>Play all</span>
            </button>
            <button
              type="button"
              class="playlist-detail-button"
              @click="goToLibrary"
            >
              <span
                class="i-tabler-playlist-add"
                aria-hidden="true"
              />
              <span>Add tracks</span>
            </button>
            <button
              type="button"
              class="playlist-detail-button"
              :disabled="updatePlaylistMutation.isPending.value"
              @click="savePlaylist"
            >
              <span
                class="i-tabler-device-floppy"
                aria-hidden="true"
              />
              <span>Save</span>
            </button>
            <button
              type="button"
              class="playlist-detail-button playlist-detail-button--danger"
              :disabled="deletePlaylistMutation.isPending.value"
              @click="handleDeletePlaylist"
            >
              <span
                class="i-tabler-trash"
                aria-hidden="true"
              />
              <span>Delete playlist</span>
            </button>
          </div>
          <p
            v-if="formError"
            class="playlist-detail-error"
          >
            {{ formError }}
          </p>
        </div>
      </header>

      <div
        v-if="!tracks.length"
        class="playlist-detail-empty"
      >
        Add tracks from the library to start playing this playlist.
      </div>
      <div
        v-else
        class="playlist-track-list"
      >
        <div
          v-for="(track, index) in tracks"
          :key="track.id"
          class="playlist-track-row"
        >
          <button
            type="button"
            class="playlist-track-main"
            @click="playTrack(track.id)"
          >
            <span class="playlist-track-index">{{ index + 1 }}</span>
            <div class="playlist-track-meta">
              <p
                class="playlist-track-title"
                :class="{ 'playlist-track-title--active': isTrackActive(track.id) }"
              >
                {{ track.title || track.filename }}
              </p>
              <p class="playlist-track-subtitle">
                {{ track.artists || track.filename }}
              </p>
            </div>
            <SoundWave
              v-if="isTrackActive(track.id)"
              :playing="isPlaying"
            />
            <span
              v-else
              class="playlist-track-duration"
            >
              {{ track.durationText || '--:--' }}
            </span>
          </button>
          <div class="playlist-track-actions">
            <button
              type="button"
              class="playlist-track-action"
              :disabled="index === 0 || reorderMutation.isPending.value"
              aria-label="Move up"
              @click="moveTrack(track.id, 'up')"
            >
              <span
                class="i-tabler-chevron-up"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="playlist-track-action"
              :disabled="index === tracks.length - 1 || reorderMutation.isPending.value"
              aria-label="Move down"
              @click="moveTrack(track.id, 'down')"
            >
              <span
                class="i-tabler-chevron-down"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="playlist-track-action playlist-track-action--danger"
              :disabled="removeTrackMutation.isPending.value"
              aria-label="Remove from playlist"
              @click="removeTrack(track.id)"
            >
              <span
                class="i-tabler-x"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>
    </template>

    <div
      v-else-if="playlistQuery.isPending.value"
      class="playlist-detail-empty"
    >
      Loading playlist...
    </div>
  </section>
</template>

<style scoped>
.playlist-detail-page {
  display: grid;
  gap: 1rem;
  padding: 1rem 0;
}

.playlist-detail-header {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--bg-surface);
}

.playlist-detail-fields {
  display: grid;
  gap: 0.75rem;
}

.playlist-detail-label {
  display: grid;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.playlist-detail-input,
.playlist-detail-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 0.75rem 0.875rem;
  resize: vertical;
}

.playlist-detail-actions {
  display: grid;
  gap: 0.75rem;
}

.playlist-detail-stats {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.playlist-detail-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
}

.playlist-detail-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0 1rem;
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 0.875rem;
}

.playlist-detail-button--primary {
  border-color: transparent;
  background: var(--accent);
  color: white;
}

.playlist-detail-button--danger {
  color: var(--danger);
}

.playlist-detail-error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--danger);
}

.playlist-detail-empty {
  padding: 2rem 1rem;
  border: 1px dashed var(--border);
  border-radius: 1rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.playlist-track-list {
  display: grid;
  gap: 0.75rem;
}

.playlist-track-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--bg-surface);
}

.playlist-track-main {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
  flex: 1;
  text-align: left;
}

.playlist-track-index {
  width: 1.5rem;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: center;
}

.playlist-track-meta {
  min-width: 0;
  flex: 1;
}

.playlist-track-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist-track-title--active {
  color: var(--accent);
}

.playlist-track-subtitle,
.playlist-track-duration {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.playlist-track-actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.playlist-track-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-base);
  color: var(--text-secondary);
}

.playlist-track-action--danger {
  color: var(--danger);
}
</style>
