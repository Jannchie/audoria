<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import SoundWave from '../components/SoundWave.vue'
import { useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const { data: tracks, isPending, isError, error } = useMusicQuery()
const { currentTrackId, isPlaying, selectTrack, setPlaying } = usePlayerState()

const search = ref('')

const total = computed(() => tracks.value?.length ?? 0)

const filteredTracks = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  const list = tracks.value ?? []
  if (!keyword) {
    return list
  }
  return list.filter(item => item.filename.toLowerCase().includes(keyword))
})

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString()
}

function handleTrackClick(id: string): void {
  if (currentTrackId.value === id) {
    setPlaying(!isPlaying.value)
  }
  else {
    selectTrack(id)
    setPlaying(true)
  }
}
</script>

<template>
  <section class="space-y-4">
    <!-- Header -->
    <header class="flex flex-wrap gap-3 items-end justify-between">
      <div>
        <h1 class="text-xl tracking-tight font-bold text-heading">
          Library
        </h1>
        <p class="text-[12px] text-[var(--text-tertiary)] mt-0.5">
          {{ total }} {{ total === 1 ? 'track' : 'tracks' }}
        </p>
      </div>
      <RouterLink
        class="text-[13px] text-white font-medium px-4 rounded-lg bg-[var(--accent)] flex gap-1.5 h-10 transition-colors items-center hover:bg-[var(--accent-hover)]"
        to="/upload"
      >
        <span class="i-tabler-plus text-sm" />
        Upload
      </RouterLink>
    </header>

    <!-- Search -->
    <div class="relative">
      <span class="i-tabler-search text-sm text-[var(--text-tertiary)] left-3.5 top-1/2 absolute -translate-y-1/2" />
      <input
        v-model="search"
        class="text-sm text-[var(--text-primary)] pl-10 pr-4 rounded-lg bg-[var(--bg-surface)] h-11 w-full transition-colors placeholder:text-[var(--text-tertiary)] focus:outline-none focus:bg-[var(--bg-elevated)]"
        placeholder="Search tracks..."
        type="search"
      >
    </div>

    <!-- Track list -->
    <div>
      <p
        v-if="isError"
        class="text-sm text-[var(--danger)] py-12 text-center"
      >
        {{ (error as Error)?.message ?? 'Failed to load tracks.' }}
      </p>

      <template v-else-if="isPending">
        <div
          v-for="i in 6"
          :key="i"
          class="px-3 py-2.5 flex gap-3 items-center"
        >
          <div class="skeleton rounded-lg shrink-0 h-11 w-11" />
          <div class="flex-1 space-y-1.5">
            <div class="skeleton rounded h-3.5 w-40" />
            <div class="skeleton rounded h-3 w-20" />
          </div>
        </div>
      </template>

      <div
        v-else-if="filteredTracks.length === 0"
        class="py-14 text-center"
      >
        <span class="i-tabler-music-off text-2xl text-[var(--text-tertiary)]" />
        <p class="text-sm text-[var(--text-secondary)] font-medium text-heading mt-3">
          {{ search ? 'No matching tracks' : 'Your library is empty' }}
        </p>
        <p class="text-[11px] text-[var(--text-tertiary)] mt-1">
          {{ search ? 'Try a different search term' : 'Upload some music to get started' }}
        </p>
      </div>

      <div
        v-else
        class="space-y-px"
      >
        <button
          v-for="(track, index) in filteredTracks"
          :key="track.id"
          type="button"
          class="group px-3 py-2.5 rounded-lg flex gap-3 w-full transition-colors items-center"
          :class="currentTrackId === track.id
            ? 'bg-[var(--accent-soft)]'
            : 'hover:bg-[var(--bg-surface)]'"
          @click="handleTrackClick(track.id)"
        >
          <!-- Album art -->
          <div class="rounded-lg bg-[var(--bg-elevated)] flex shrink-0 h-11 w-11 items-center justify-center">
            <span
              class="text-[11px] font-bold text-heading"
              :class="currentTrackId === track.id ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'"
            >
              {{ track.filename.charAt(0).toUpperCase() }}
            </span>
          </div>

          <!-- Track info -->
          <div class="text-left flex-1 min-w-0">
            <p
              class="text-[13px] leading-tight font-medium text-heading truncate"
              :class="currentTrackId === track.id ? 'text-[var(--accent)]' : ''"
            >
              {{ track.filename }}
            </p>
            <p class="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              {{ formatDate(track.createdAt) }}
            </p>
          </div>

          <!-- Right side -->
          <div class="flex shrink-0 w-6 items-center justify-center">
            <SoundWave
              v-if="currentTrackId === track.id"
              :playing="isPlaying"
            />
            <span
              v-else
              class="text-[11px] text-[var(--text-tertiary)] tabular-nums"
            >
              {{ String(index + 1).padStart(2, '0') }}
            </span>
          </div>
        </button>
      </div>
    </div>
  </section>
</template>
