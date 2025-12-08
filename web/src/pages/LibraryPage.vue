<script setup lang="ts">
import type { Music } from '../api/types.gen'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const { data: tracks, isPending, isError, error } = useMusicQuery()
const { currentTrackId, selectTrack } = usePlayerState()

const tabs = [
  'Songs',
  'Workspaces',
  'Studio Projects',
  'Personas',
  'Hooks',
  'Liked Hooks',
  'History',
]

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
  return new Date(value).toLocaleString()
}

function formatSize(size: number): string {
  if (size >= 1_048_576) {
    return `${(size / 1_048_576).toFixed(1)} MB`
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${size} B`
}

function vibeFor(track: Music): string {
  const palette = ['dynamic', 'nostalgic', 'dreamy', 'high-energy', 'chill', 'uplifting']
  const codePoint = [...track.filename].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0)
  return palette[codePoint % palette.length] ?? 'dynamic'
}
</script>

<template>
  <section class="space-y-6">
    <header class="flex gap-4 items-center justify-between">
      <div>
        <p class="text-xs text-slate-500 tracking-[0.25em] uppercase">
          Library
        </p>
        <h2 class="text-3xl text-white font-semibold">
          Keep your takes together
        </h2>
        <p class="text-sm text-slate-400">
          Browse uploads, pick what to hear next, and keep the player synced.
        </p>
      </div>
      <div class="text-right">
        <p class="text-xs text-slate-500 tracking-[0.2em] uppercase">
          Total
        </p>
        <p class="text-xl text-white font-semibold">
          {{ total }}
        </p>
        <RouterLink
          class="text-sm text-white mt-2 px-3 py-2 border border-blue-500/70 rounded-lg bg-blue-500/10 inline-flex gap-2 items-center hover:bg-blue-500/20"
          to="/upload"
        >
          <span class="i-tabler-upload" />
          Upload
        </RouterLink>
      </div>
    </header>

    <div class="px-4 py-3 border border-slate-800 rounded-2xl bg-[#0c101a]">
      <div class="flex flex-wrap gap-3 items-center">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in tabs"
            :key="tab"
            class="text-xs px-3 py-2 border rounded-full transition-colors"
            :class="tab === 'Songs'
              ? 'border-blue-500/60 bg-blue-500/10 text-white'
              : 'border-slate-700 text-slate-400 hover:bg-slate-800/80'"
            type="button"
          >
            {{ tab }}
          </button>
        </div>
        <div class="flex-1 min-w-[220px] relative">
          <span class="i-tabler-search text-slate-500 left-3 top-1/2 absolute -translate-y-1/2" />
          <input
            v-model="search"
            class="text-sm text-slate-100 py-2 pl-10 pr-4 border border-slate-800 rounded-xl bg-slate-900/60 w-full placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            placeholder="Search by filename"
            type="search"
          >
        </div>
        <div class="text-xs text-slate-400 flex gap-2 items-center">
          <span class="px-3 py-2 border border-slate-700 rounded-full bg-slate-900/60">Filters</span>
          <span class="px-3 py-2 border border-slate-700 rounded-full bg-slate-900/60">Newest</span>
        </div>
      </div>
    </div>

    <div class="border border-slate-800 rounded-2xl bg-[#0c101a] overflow-hidden divide-slate-800/80 divide-y">
      <p v-if="isError" class="text-sm text-amber-400 px-5 py-4">
        {{ (error as Error)?.message ?? 'Failed to load tracks.' }}
      </p>
      <p v-else-if="filteredTracks.length === 0 && !isPending" class="text-sm text-slate-400 px-5 py-4">
        No tracks found. Upload to start listening.
      </p>
      <p v-else-if="isPending" class="text-sm text-slate-400 px-5 py-4">
        Loading your library…
      </p>
      <button
        v-for="track in filteredTracks"
        v-else
        :key="track.id"
        class="group px-5 py-4 text-left flex gap-4 w-full transition-colors items-center hover:bg-slate-900/60"
        :class="currentTrackId === track.id ? 'border-l-2 border-blue-500/70' : 'border-l-2 border-transparent'"
        @click="selectTrack(track.id)"
      >
        <div class="text-lg text-white font-semibold rounded-xl bg-slate-800 flex h-16 w-16 items-center justify-center">
          {{ track.filename.charAt(0).toUpperCase() }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex gap-2 items-center">
            <p class="text-base text-white font-semibold truncate">
              {{ track.filename }}
            </p>
            <span class="text-[11px] text-slate-400 px-2 py-1 border border-slate-700 rounded-full">
              {{ track.contentType || 'audio' }}
            </span>
          </div>
          <div class="text-xs text-slate-400 mt-2 flex flex-wrap gap-2 items-center">
            <span class="px-2 py-1 border border-slate-700 rounded-full bg-slate-900/70">
              {{ vibeFor(track) }}
            </span>
            <span class="px-2 py-1 border border-slate-700 rounded-full bg-slate-900/70">
              {{ formatSize(track.size) }}
            </span>
            <span class="px-2 py-1 border border-slate-700 rounded-full bg-slate-900/70">
              {{ formatDate(track.createdAt) }}
            </span>
          </div>
        </div>
        <div class="text-slate-400 flex gap-3 items-center">
          <span class="i-tabler-player-play-filled text-lg group-hover:text-white" />
          <span class="i-tabler-dots text-lg" />
        </div>
        <div
          class="text-xs px-3 py-1 border rounded-full"
          :class="currentTrackId === track.id
            ? 'border-blue-500/70 bg-blue-500/10 text-white'
            : 'border-slate-700 bg-slate-900/70 text-slate-300'"
        >
          {{ currentTrackId === track.id ? 'Selected' : 'Set to Play' }}
        </div>
      </button>
    </div>
  </section>
</template>
