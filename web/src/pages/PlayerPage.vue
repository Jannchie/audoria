<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import SoundWave from '../components/SoundWave.vue'
import { buildDownloadUrl, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const { data: tracks, isPending } = useMusicQuery()
const { currentTrackId, isPlaying, currentTime, duration, selectTrack, setPlaying } = usePlayerState()

const currentTrack = computed(() => {
  const items = tracks.value ?? []
  if (items.length === 0) {
    return null
  }
  return items.find(item => item.id === currentTrackId.value) ?? items[0]
})

const downloadUrl = computed(() => {
  if (!currentTrack.value) {
    return ''
  }
  return buildDownloadUrl(currentTrack.value.id)
})

const progress = computed(() => {
  if (!duration.value) {
    return 0
  }
  return Math.min(100, (currentTime.value / duration.value) * 100)
})

function handlePick(id: string): void {
  if (currentTrackId.value === id) {
    setPlaying(!isPlaying.value)
  }
  else {
    selectTrack(id)
    setPlaying(true)
  }
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString()
}

function formattedTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '0:00'
  }
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
</script>

<template>
  <section class="space-y-6">
    <!-- Now playing -->
    <div class="p-5 rounded-xl bg-[var(--bg-surface)]">
      <div class="flex gap-5 items-center">
        <!-- Album art -->
        <div class="rounded-lg bg-[var(--bg-elevated)] flex shrink-0 h-20 w-20 items-center justify-center sm:h-24 sm:w-24">
          <span class="text-2xl text-[var(--text-tertiary)] font-bold text-heading sm:text-3xl">
            {{ (currentTrack?.filename?.charAt(0) ?? 'A').toUpperCase() }}
          </span>
        </div>

        <div class="flex-1 min-w-0">
          <p class="text-[11px] text-[var(--accent)] tracking-[0.15em] font-medium mb-1 uppercase">
            Now Playing
          </p>
          <h1 class="text-lg leading-tight font-bold text-heading truncate sm:text-xl">
            {{ currentTrack?.filename ?? 'Pick a track' }}
          </h1>
          <p class="text-[12px] text-[var(--text-tertiary)] mt-0.5">
            {{ currentTrack ? shortDate(currentTrack.createdAt) : 'No track selected' }}
          </p>

          <!-- Progress -->
          <div
            v-if="currentTrack"
            class="mt-3"
          >
            <div class="rounded-full bg-[var(--bg-hover)] h-1.5 w-full">
              <div
                class="rounded-full bg-[var(--accent)] h-full transition-none"
                :style="{ width: `${progress}%` }"
              />
            </div>
            <div class="text-[10px] text-[var(--text-tertiary)] mt-1 flex justify-between tabular-nums">
              <span>{{ formattedTime(currentTime) }}</span>
              <span>{{ formattedTime(duration) }}</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="mt-3 flex gap-2 items-center">
            <RouterLink
              class="text-[12px] text-[var(--text-tertiary)] font-medium px-3 rounded-lg bg-[var(--bg-elevated)] flex gap-1.5 h-9 transition-colors items-center hover:text-[var(--text-secondary)]"
              to="/library"
            >
              <span class="i-tabler-vinyl text-sm" />
              Library
            </RouterLink>
            <a
              v-if="downloadUrl"
              :href="downloadUrl"
              class="text-[12px] text-[var(--text-tertiary)] font-medium px-3 rounded-lg bg-[var(--bg-elevated)] flex gap-1.5 h-9 transition-colors items-center hover:text-[var(--text-secondary)]"
              target="_blank"
              rel="noreferrer"
            >
              <span class="i-tabler-download text-sm" />
              Download
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- Queue -->
    <div>
      <div class="mb-2 px-1 flex items-center justify-between">
        <h2 class="text-[12px] text-[var(--text-tertiary)] tracking-[0.12em] font-medium text-heading uppercase">
          Up Next
        </h2>
        <span class="text-[11px] text-[var(--text-tertiary)]">
          {{ tracks?.length ?? 0 }} tracks
        </span>
      </div>

      <div class="space-y-px">
        <p
          v-if="isPending"
          class="text-sm text-[var(--text-tertiary)] py-8 text-center"
        >
          Loading...
        </p>
        <p
          v-else-if="!(tracks?.length)"
          class="text-sm text-[var(--text-tertiary)] py-8 text-center"
        >
          No tracks in queue.
        </p>

        <button
          v-for="(track, index) in tracks?.slice(0, 20)"
          v-else
          :key="track.id"
          type="button"
          class="group px-3 py-2.5 rounded-lg flex gap-3 w-full transition-colors items-center"
          :class="track.id === currentTrackId
            ? 'bg-[var(--accent-soft)]'
            : 'hover:bg-[var(--bg-surface)]'"
          @click="handlePick(track.id)"
        >
          <span
            class="text-[11px] text-center shrink-0 w-5 tabular-nums"
            :class="track.id === currentTrackId ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'"
          >
            {{ String(index + 1).padStart(2, '0') }}
          </span>

          <div class="rounded-lg bg-[var(--bg-elevated)] flex shrink-0 h-11 w-11 items-center justify-center">
            <span
              class="text-[10px] font-bold text-heading"
              :class="track.id === currentTrackId ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'"
            >
              {{ track.filename.charAt(0).toUpperCase() }}
            </span>
          </div>

          <div class="text-left flex-1 min-w-0">
            <p
              class="text-[13px] leading-tight font-medium text-heading truncate"
              :class="track.id === currentTrackId ? 'text-[var(--accent)]' : ''"
            >
              {{ track.filename }}
            </p>
            <p class="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              {{ shortDate(track.createdAt) }}
            </p>
          </div>

          <SoundWave
            v-if="track.id === currentTrackId"
            :playing="isPlaying"
          />
        </button>
      </div>
    </div>
  </section>
</template>
