<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { buildDownloadUrl, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const { data: tracks, isPending } = useMusicQuery()
const { currentTrackId, selectTrack, setPlaying } = usePlayerState()

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

function handlePick(id: string): void {
  selectTrack(id)
  setPlaying(true)
}
</script>

<template>
  <section class="space-y-6">
    <div class="p-6 border border-slate-800 rounded-2xl bg-[#0c101a]">
      <div class="flex gap-4 items-start justify-between">
        <div>
          <p class="text-xs text-slate-500 tracking-[0.25em] uppercase">
            Now Playing
          </p>
          <h2 class="text-3xl text-white font-semibold">
            {{ currentTrack?.filename ?? 'No track selected' }}
          </h2>
          <p class="text-sm text-slate-400">
            {{ isPending ? 'Loading library…' : currentTrack ? 'Ready in the player bar.' : 'Pick a track from Library.' }}
          </p>
        </div>
        <RouterLink
          class="text-sm text-slate-200 px-3 py-2 border border-slate-700 rounded-lg hover:bg-slate-800"
          to="/library"
        >
          Back to Library
        </RouterLink>
      </div>

      <div class="mt-6 gap-5 grid md:grid-cols-3">
        <div class="p-4 border border-slate-800 rounded-xl bg-slate-900/60 flex gap-4 items-center md:col-span-2">
          <div class="text-lg text-white font-semibold rounded-xl bg-slate-800 flex h-24 w-24 items-center justify-center">
            {{ currentTrack?.filename.charAt(0).toUpperCase() ?? 'A' }}
          </div>
          <div class="space-y-2">
            <p class="text-lg text-white font-semibold">
              {{ currentTrack?.filename ?? 'Select something to play' }}
            </p>
            <p class="text-sm text-slate-400">
              {{ currentTrack ? new Date(currentTrack.createdAt).toLocaleString() : 'Uploads appear here once selected.' }}
            </p>
            <div class="text-xs text-slate-400 flex flex-wrap gap-2">
              <span class="px-2 py-1 border border-slate-700 rounded-full bg-slate-900/70">
                {{ currentTrack?.contentType ?? 'audio' }}
              </span>
              <span class="px-2 py-1 border border-slate-700 rounded-full bg-slate-900/70">
                {{ currentTrack ? `${(currentTrack.size / 1024).toFixed(1)} KB` : 'No size' }}
              </span>
            </div>
          </div>
        </div>
        <div class="text-sm text-slate-300 p-4 border border-slate-800 rounded-xl bg-slate-900/60 space-y-3">
          <p class="text-xs text-slate-500 tracking-[0.2em] uppercase">
            Actions
          </p>
          <p>Use the player bar to control playback and looping.</p>
          <a
            v-if="downloadUrl"
            :href="downloadUrl"
            class="text-sm text-blue-400 inline-flex gap-2 items-center hover:text-blue-300"
            target="_blank"
            rel="noreferrer"
          >
            <span class="i-tabler-external-link" />
            Open source URL
          </a>
          <p v-else class="text-slate-500">
            Select a track to unlock actions.
          </p>
        </div>
      </div>
    </div>

    <div class="p-5 border border-slate-800 rounded-2xl bg-[#0c101a]">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs text-slate-500 tracking-[0.25em] uppercase">
            Quick Picks
          </p>
          <h3 class="text-lg text-white font-semibold">
            Recent tracks
          </h3>
        </div>
        <RouterLink
          class="text-sm text-slate-200 px-3 py-2 border border-slate-700 rounded-lg hover:bg-slate-800"
          to="/library"
        >
          Manage Library
        </RouterLink>
      </div>
      <div class="mt-4 space-y-2">
        <p v-if="isPending" class="text-sm text-slate-400">
          Loading…
        </p>
        <p v-else-if="!(tracks?.length)" class="text-sm text-slate-400">
          Nothing here yet. Upload a track first.
        </p>
        <button
          v-for="track in tracks?.slice(0, 8)"
          v-else
          :key="track.id"
          class="px-3 py-3 text-left border border-slate-800 rounded-xl bg-slate-900/60 flex gap-3 w-full transition-colors items-center justify-between hover:bg-slate-800"
          @click="handlePick(track.id)"
        >
          <div class="flex gap-3 min-w-0 items-center">
            <span class="text-sm text-white font-semibold rounded-lg bg-slate-800 flex h-10 w-10 items-center justify-center">
              {{ track.filename.charAt(0).toUpperCase() }}
            </span>
            <div class="min-w-0">
              <p class="text-sm text-white font-semibold truncate">
                {{ track.filename }}
              </p>
              <p class="text-xs text-slate-400">
                {{ new Date(track.createdAt).toLocaleDateString() }}
              </p>
            </div>
          </div>
          <span
            class="text-xs px-2 py-1 border rounded-full"
            :class="track.id === currentTrackId ? 'border-blue-500/70 bg-blue-500/10 text-white' : 'border-slate-700 bg-slate-900/70 text-slate-300'"
          >
            {{ track.id === currentTrackId ? 'Playing' : 'Play' }}
          </span>
        </button>
      </div>
    </div>
  </section>
</template>
