<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import SoundWave from '../components/SoundWave.vue'
import { resolveApiUrl, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const router = useRouter()
const { data: tracks, isPending, isError, error } = useMusicQuery()
const { currentTrackId, isPlaying, selectTrack, setPlaying } = usePlayerState()

const search = ref('')

const filteredTracks = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  const list = tracks.value ?? []
  if (!keyword) return list
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
    selectTrack(id)
    setPlaying(true)
    router.push('/player')
  }
}

function trackCoverUrl(coverUrl: string | null): string {
  return coverUrl ? resolveApiUrl(coverUrl) : ''
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
        placeholder="Search"
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
        {{ (error as Error)?.message ?? 'Failed to load tracks.' }}
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
              :style="{ width: `${120 + Math.random() * 80}px` }"
            />
            <div
              class="skeleton rounded h-3"
              :style="{ width: `${60 + Math.random() * 60}px` }"
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
        {{ search ? 'No results' : 'No music yet' }}
      </p>
      <p class="empty-hint">
        {{ search ? 'Try a different keyword' : 'Upload or download tracks to start listening' }}
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
        @click="handleTrackClick(track.id)"
      >
        <div class="track-cover">
          <img
            v-if="track.coverUrl"
            :src="trackCoverUrl(track.coverUrl)"
            :alt="track.title || track.filename"
            class="track-cover-img"
          >
          <span
            v-else
            class="i-tabler-music track-cover-placeholder"
          />
          <!-- Play overlay on hover -->
          <div class="track-cover-overlay">
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
              <template v-if="track.album"> · {{ track.album }}</template>
            </template>
            <template v-else>
              {{ track.filename }}
            </template>
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
        </div>
      </button>
    </div>
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
    position: relative;
    padding: 0;
    margin-bottom: 0.5rem;
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

.track-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.track-duration {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ---- Empty state ---- */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 5rem 1rem;
  text-align: center;
}

.empty-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-top: 1rem;
  font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
}

.empty-text {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  margin-top: 0.5rem;
}

.empty-hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-top: 0.375rem;
}
</style>
