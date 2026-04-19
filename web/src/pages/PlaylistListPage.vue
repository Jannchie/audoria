<script setup lang="ts">
import type { Playlist } from '../api/types.gen'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCreatePlaylist, useDeletePlaylist, usePlaylistsQuery } from '../composables/usePlaylists'

const router = useRouter()
const { data: playlists, isPending, isError, error } = usePlaylistsQuery()
const createPlaylistMutation = useCreatePlaylist()
const deletePlaylistMutation = useDeletePlaylist()

const name = ref('')
const description = ref('')
const formError = ref('')

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
    name.value = ''
    description.value = ''
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
    <div class="playlists-hero">
      <div>
        <h1 class="playlists-title">
          Playlists
        </h1>
        <p class="playlists-subtitle">
          Build focused queues from your library.
        </p>
      </div>
    </div>

    <section class="playlist-create">
      <div class="playlist-create-fields">
        <label class="playlist-label">
          <span>Name</span>
          <input
            v-model="name"
            class="playlist-input"
            type="text"
            maxlength="120"
            :disabled="isCreating"
            placeholder="New playlist"
          >
        </label>
        <label class="playlist-label">
          <span>Description</span>
          <textarea
            v-model="description"
            class="playlist-textarea"
            rows="3"
            maxlength="2000"
            :disabled="isCreating"
            placeholder="Optional description"
          />
        </label>
      </div>
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
        <span>Create playlist</span>
      </button>
      <p
        v-if="formError"
        class="playlist-error"
      >
        {{ formError }}
      </p>
    </section>

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
      v-else-if="!playlists?.length"
      class="playlist-empty"
    >
      No playlists yet.
    </div>
    <div
      v-else
      class="playlist-grid"
    >
      <article
        v-for="playlist in playlists"
        :key="playlist.id"
        class="playlist-card"
      >
        <div class="playlist-card-header">
          <button
            type="button"
            class="playlist-card-main"
            @click="openPlaylist(playlist.id)"
          >
            <h2 class="playlist-card-title">
              {{ playlist.name }}
            </h2>
            <p
              v-if="playlist.description"
              class="playlist-card-description"
            >
              {{ playlist.description }}
            </p>
          </button>
          <button
            type="button"
            class="playlist-card-delete"
            aria-label="Delete playlist"
            @click="handleDelete(playlist, $event)"
          >
            <span
              class="i-tabler-trash"
              aria-hidden="true"
            />
          </button>
        </div>
        <div class="playlist-card-meta">
          <span>{{ playlist.trackCount }} tracks</span>
          <span>{{ formatDuration(playlist.totalDurationSeconds) }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.playlists-page {
  display: grid;
  gap: 1rem;
  padding: 1rem 0;
}

.playlists-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
}

.playlists-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}

.playlists-subtitle {
  margin: 0.375rem 0 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.playlist-create {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--bg-surface);
}

.playlist-create-fields {
  display: grid;
  gap: 0.75rem;
}

.playlist-label {
  display: grid;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.playlist-input,
.playlist-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 0.75rem 0.875rem;
  resize: vertical;
}

.playlist-submit {
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

.playlist-error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--danger);
}

.playlist-grid {
  display: grid;
  gap: 0.875rem;
}

@media (min-width: 768px) {
  .playlist-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.playlist-card {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--bg-surface);
  text-align: left;
}

.playlist-card--skeleton {
  min-height: 8.5rem;
}

.playlist-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.playlist-card-main {
  min-width: 0;
  flex: 1;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
}

.playlist-card-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.playlist-card-description {
  margin: 0.375rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.playlist-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.playlist-card-delete {
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

.playlist-empty {
  padding: 2rem 1rem;
  border: 1px dashed var(--border);
  border-radius: 1rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-secondary);
}
</style>
