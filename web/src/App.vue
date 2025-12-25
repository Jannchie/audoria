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
  <div class="text-slate-100 bg-[var(--bg-primary)] flex min-h-screen">
    <aside class="px-6 py-6 border-r border-[var(--line)] bg-[var(--bg-surface)]/85 flex flex-col gap-8 w-72">
      <div class="flex gap-3 items-center">
        <div class="text-white font-semibold rounded-xl bg-[var(--accent)] flex h-11 w-11 items-center justify-center">
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

      <nav class="space-y-2">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          class="text-sm px-3 py-2 rounded-lg flex gap-3 transition-colors items-center"
          :class="currentPath.startsWith(item.path)
            ? 'bg-[var(--accent)]/15 text-white border border-[var(--accent)]/40'
            : 'text-slate-300 hover:bg-[var(--bg-muted)]/70 border border-transparent'"
          :to="item.path"
        >
          <span class="text-lg" :class="[item.icon]" />
          {{ item.name }}
        </RouterLink>
      </nav>

      <div class="text-sm text-slate-300 mt-auto space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs text-slate-500 tracking-[0.25em] uppercase">API</span>
          <span class="text-right max-w-[140px] truncate" :title="apiBase">
            {{ apiBase }}
          </span>
        </div>
        <div class="text-xs text-slate-400 flex items-center justify-between">
          <span>Selected</span>
          <span class="text-slate-100 max-w-[150px] truncate" :title="currentTrackId ?? 'None'">
            {{ currentTrackId ?? 'None' }}
          </span>
        </div>
        <p class="text-xs text-slate-500 leading-relaxed">
          Upload refreshes Library instantly; the player stays in sync.
        </p>
      </div>
    </aside>

    <div class="flex flex-1 flex-col">
      <header class="px-10 py-5 border-b border-[var(--line)] bg-[var(--bg-surface)]/85 backdrop-blur">
        <p class="text-xs text-slate-500 tracking-[0.3em] uppercase">
          {{ currentNav?.name ?? 'Library' }}
        </p>
        <h1 class="text-2xl text-white font-semibold">
          Sonic workspace
        </h1>
        <p class="text-sm text-slate-400">
          Curate, upload, and play in one continuous surface.
        </p>
      </header>

      <main class="px-10 pb-32 pt-8 bg-[var(--bg-primary)] flex-1 overflow-y-auto">
        <RouterView />
      </main>
    </div>

    <PlayerBar />
  </div>
</template>
