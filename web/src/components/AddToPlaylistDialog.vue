<script setup lang="ts">
import type { Music, PlaylistDetail } from '../api/types.gen'
import { computed, ref, watch } from 'vue'
import { usePlayerState } from '../composables/usePlayerState'
import { useAddTrackToPlaylist, useCreatePlaylist, usePlaylistsQuery } from '../composables/usePlaylists'

const props = defineProps<{
  open: boolean
  track: Music | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'added', playlist: PlaylistDetail): void
}>()

const { data: playlists } = usePlaylistsQuery()
const createPlaylistMutation = useCreatePlaylist()
const addTrackMutation = useAddTrackToPlaylist()
const { playbackContext, syncTrackContext } = usePlayerState()

const error = ref('')
const newPlaylistName = ref('')
const newPlaylistDescription = ref('')

const isPending = computed(() =>
  createPlaylistMutation.isPending.value || addTrackMutation.isPending.value,
)

watch(() => props.open, (open) => {
  if (!open) {
    error.value = ''
    newPlaylistName.value = ''
    newPlaylistDescription.value = ''
  }
})

function closeDialog(): void {
  if (isPending.value) {
    return
  }
  emit('close')
}

function syncCurrentPlaylistIfNeeded(playlist: PlaylistDetail): void {
  const context = playbackContext.value
  if (context?.type !== 'playlist' || context.playlistId !== playlist.id) {
    return
  }
  syncTrackContext(playlist.tracks, { type: 'playlist', playlistId: playlist.id })
}

async function addToExistingPlaylist(playlistId: string): Promise<void> {
  if (!props.track || isPending.value) {
    return
  }

  error.value = ''

  try {
    const playlist = await addTrackMutation.mutateAsync({
      playlistId,
      trackId: props.track.id,
    })
    syncCurrentPlaylistIfNeeded(playlist)
    emit('added', playlist)
    emit('close')
  }
  catch (error_) {
    error.value = error_ instanceof Error ? error_.message : 'Failed to add track to playlist.'
  }
}

async function createPlaylistAndAdd(): Promise<void> {
  if (!props.track || isPending.value) {
    return
  }

  const name = newPlaylistName.value.trim()
  if (!name) {
    error.value = 'Playlist name is required.'
    return
  }

  error.value = ''

  try {
    const playlist = await createPlaylistMutation.mutateAsync({
      name,
      description: newPlaylistDescription.value.trim() || null,
    })
    const updated = await addTrackMutation.mutateAsync({
      playlistId: playlist.id,
      trackId: props.track.id,
    })
    syncCurrentPlaylistIfNeeded(updated)
    emit('added', updated)
    emit('close')
  }
  catch (error_) {
    error.value = error_ instanceof Error ? error_.message : 'Failed to create playlist.'
  }
}

function handleBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    closeDialog()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="playlist-dialog-fade">
      <div
        v-if="open && track"
        class="playlist-dialog-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-dialog-title"
        @mousedown="handleBackdropClick"
      >
        <div
          class="playlist-dialog-panel"
          @mousedown.stop
        >
          <header class="playlist-dialog-header">
            <div>
              <h2
                id="playlist-dialog-title"
                class="playlist-dialog-title"
              >
                Add to playlist
              </h2>
              <p class="playlist-dialog-subtitle">
                {{ track.title || track.filename }}
              </p>
            </div>
            <button
              type="button"
              class="playlist-dialog-close"
              :disabled="isPending"
              aria-label="Close"
              @click="closeDialog"
            >
              <span
                class="i-tabler-x"
                aria-hidden="true"
              />
            </button>
          </header>

          <div class="playlist-dialog-body">
            <section class="playlist-dialog-section">
              <h3 class="playlist-dialog-section-title">
                Existing playlists
              </h3>
              <div
                v-if="playlists?.length"
                class="playlist-dialog-list"
              >
                <button
                  v-for="playlist in playlists"
                  :key="playlist.id"
                  type="button"
                  class="playlist-dialog-list-item"
                  :disabled="isPending"
                  @click="addToExistingPlaylist(playlist.id)"
                >
                  <span class="playlist-dialog-list-name">{{ playlist.name }}</span>
                  <span class="playlist-dialog-list-meta">{{ playlist.trackCount }} tracks</span>
                </button>
              </div>
              <p
                v-else
                class="playlist-dialog-empty"
              >
                No playlists yet.
              </p>
            </section>

            <section class="playlist-dialog-section">
              <h3 class="playlist-dialog-section-title">
                Create a new playlist
              </h3>
              <div class="playlist-dialog-form">
                <label class="playlist-dialog-label">
                  <span>Name</span>
                  <input
                    v-model="newPlaylistName"
                    class="playlist-dialog-input"
                    type="text"
                    maxlength="120"
                    :disabled="isPending"
                    placeholder="Playlist name"
                  >
                </label>
                <label class="playlist-dialog-label">
                  <span>Description</span>
                  <textarea
                    v-model="newPlaylistDescription"
                    class="playlist-dialog-textarea"
                    rows="3"
                    maxlength="2000"
                    :disabled="isPending"
                    placeholder="Optional description"
                  />
                </label>
                <button
                  type="button"
                  class="playlist-dialog-submit"
                  :disabled="isPending"
                  @click="createPlaylistAndAdd"
                >
                  <span
                    v-if="isPending"
                    class="i-tabler-loader-2 animate-spin"
                    aria-hidden="true"
                  />
                  <span
                    v-else
                    class="i-tabler-plus"
                    aria-hidden="true"
                  />
                  <span>Create and add</span>
                </button>
              </div>
            </section>

            <p
              v-if="error"
              class="playlist-dialog-error"
            >
              {{ error }}
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.playlist-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.56);
}

.playlist-dialog-panel {
  width: min(100%, 30rem);
  max-height: calc(100vh - 2rem);
  overflow: auto;
  border-radius: 1rem;
  border: 1px solid var(--border);
  background: var(--bg-base);
}

.playlist-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1rem 0.75rem;
}

.playlist-dialog-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.playlist-dialog-subtitle {
  margin: 0.375rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.playlist-dialog-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--text-tertiary);
}

.playlist-dialog-body {
  display: grid;
  gap: 1rem;
  padding: 0 1rem 1rem;
}

.playlist-dialog-section {
  display: grid;
  gap: 0.75rem;
}

.playlist-dialog-section-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.playlist-dialog-list {
  display: grid;
  gap: 0.5rem;
}

.playlist-dialog-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  text-align: left;
}

.playlist-dialog-list-name {
  font-size: 0.875rem;
  font-weight: 500;
}

.playlist-dialog-list-meta,
.playlist-dialog-empty {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.playlist-dialog-form {
  display: grid;
  gap: 0.75rem;
}

.playlist-dialog-label {
  display: grid;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.playlist-dialog-input,
.playlist-dialog-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  padding: 0.75rem 0.875rem;
  resize: vertical;
}

.playlist-dialog-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  border: none;
  border-radius: 0.875rem;
  background: var(--accent);
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
}

.playlist-dialog-error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--danger);
}

.playlist-dialog-fade-enter-active,
.playlist-dialog-fade-leave-active {
  transition: opacity 0.15s ease;
}

.playlist-dialog-fade-enter-from,
.playlist-dialog-fade-leave-to {
  opacity: 0;
}
</style>
