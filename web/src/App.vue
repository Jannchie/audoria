<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { client } from './api/client.gen'
import PlayerBar from './components/PlayerBar.vue'
import { usePlayerState } from './composables/usePlayerState'

const { currentTrackId } = usePlayerState()
const route = useRoute()

const navItems = [
  { name: 'Library', path: '/library', icon: 'i-tabler-music' },
  { name: 'Upload', path: '/upload', icon: 'i-tabler-cloud-up' },
  { name: 'Now Playing', path: '/player', icon: 'i-tabler-player-play' },
]

const currentPath = computed(() => route.path)
const currentNav = computed(() => navItems.find(item => currentPath.value.startsWith(item.path)))
const apiBase = computed(() => client.getConfig().baseUrl ?? 'Not configured')
</script>

<template>
  <div class="text-slate-100 bg-[#090c13] flex min-h-screen">
    <aside class="px-6 py-6 border-r border-slate-800 bg-[#0b0f17] flex flex-col gap-8 w-72">
      <div class="flex gap-3 items-center">
        <div class="text-white font-semibold rounded-2xl bg-blue-500 flex h-11 w-11 items-center justify-center">
          AU
        </div>
        <div>
          <p class="text-xs text-slate-500 tracking-[0.25em] uppercase">
            Audoria
          </p>
          <p class="text-lg text-white font-semibold">
            Music Lab
          </p>
        </div>
      </div>

      <nav class="space-y-1">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          class="text-sm px-3 py-2 rounded-xl flex gap-3 transition-colors items-center"
          :class="currentPath.startsWith(item.path)
            ? 'bg-blue-500/10 text-white border border-blue-500/50'
            : 'text-slate-300 hover:bg-slate-800/80 border border-transparent'"
          :to="item.path"
        >
          <span class="text-lg" :class="[item.icon]" />
          {{ item.name }}
        </RouterLink>
      </nav>

      <div class="text-sm text-slate-300 p-4 border border-slate-800 rounded-2xl bg-[#0d111d] space-y-1">
        <p class="text-xs text-slate-500 tracking-[0.2em] uppercase">
          API Base
        </p>
        <p class="text-sm text-white font-medium truncate" :title="apiBase">
          {{ apiBase }}
        </p>
        <p class="text-xs text-slate-500">
          Upload refreshes the library automatically.
        </p>
      </div>

      <div class="mt-auto space-y-3">
        <div class="text-xs text-slate-400 flex items-center justify-between">
          <span>Selected</span>
          <span class="text-slate-100 max-w-[130px] truncate" :title="currentTrackId ?? 'None'">
            {{ currentTrackId ?? 'None' }}
          </span>
        </div>
        <div class="px-4 py-3 border border-slate-800 rounded-xl bg-[#0f1422]">
          <p class="text-xs text-slate-500 tracking-[0.25em] uppercase">
            Quick tips
          </p>
          <p class="text-sm text-slate-200">
            Add tracks in Upload, then control playback in Now Playing.
          </p>
        </div>
      </div>
    </aside>

    <div class="flex flex-1 flex-col">
      <header class="border-b border-slate-800 bg-[#0b0f17]/80 backdrop-blur">
        <div class="px-8 py-5 flex gap-6 items-center justify-between">
          <div>
            <p class="text-xs text-slate-500 tracking-[0.25em] uppercase">
              Dashboard
            </p>
            <h1 class="text-2xl text-white font-semibold">
              {{ currentNav?.name ?? 'Library' }}
            </h1>
            <p class="text-sm text-slate-400">
              Curate your uploads, preview them, and keep the player synced.
            </p>
          </div>
          <div class="flex gap-3 items-center">
            <RouterLink
              class="text-sm text-slate-200 px-3 py-2 border border-slate-700 rounded-lg hover:bg-slate-800"
              to="/library"
            >
              Library
            </RouterLink>
            <RouterLink
              class="text-sm text-white px-3 py-2 border border-blue-500/60 rounded-lg bg-blue-500/10 hover:bg-blue-500/20"
              to="/upload"
            >
              Upload
            </RouterLink>
            <RouterLink
              class="text-sm text-slate-200 px-3 py-2 border border-slate-700 rounded-lg hover:bg-slate-800"
              to="/player"
            >
              Now Playing
            </RouterLink>
          </div>
        </div>
      </header>

      <main class="px-8 pb-32 pt-6 flex-1 overflow-y-auto">
        <RouterView />
      </main>
    </div>

    <PlayerBar />
  </div>
</template>
