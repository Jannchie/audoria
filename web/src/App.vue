<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import PlayerBar from './components/PlayerBar.vue'

const route = useRoute()

const navItems = [
  { name: 'Library', path: '/library', icon: 'i-tabler-vinyl' },
  { name: 'Upload', path: '/upload', icon: 'i-tabler-cloud-up' },
  { name: 'Player', path: '/player', icon: 'i-tabler-wave-sine' },
]

const currentPath = computed(() => route.path)
</script>

<template>
  <div class="bg-[var(--bg-base)] min-h-screen">
    <header class="border-b border-[var(--border)] bg-[var(--bg-primary)] top-0 sticky z-30">
      <div class="mx-auto px-5 flex h-14 max-w-3xl items-center justify-between">
        <RouterLink
          to="/"
          class="flex gap-2.5 items-center"
        >
          <div class="text-[11px] text-white tracking-widest font-bold text-heading rounded-lg bg-[var(--accent)] flex h-8 w-8 items-center justify-center">
            A
          </div>
          <span class="text-xs text-[var(--text-secondary)] tracking-[0.2em] font-semibold text-heading hidden uppercase sm:inline">
            Audoria
          </span>
        </RouterLink>

        <nav class="p-1 rounded-xl bg-[var(--bg-surface)] flex gap-0.5 items-center">
          <RouterLink
            v-for="item in navItems"
            :key="item.path"
            class="text-xs px-3 py-2 rounded-lg flex gap-1.5 transition-colors items-center"
            :class="currentPath.startsWith(item.path)
              ? 'text-[var(--text-primary)] bg-[var(--bg-elevated)] font-medium'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'"
            :to="item.path"
            :aria-label="item.name"
          >
            <span
              class="text-base"
              :class="[item.icon]"
            />
            <span class="hidden sm:inline">{{ item.name }}</span>
          </RouterLink>
        </nav>
      </div>
    </header>

    <main class="mx-auto px-5 pb-32 pt-5 max-w-3xl">
      <RouterView v-slot="{ Component }">
        <Transition
          name="page"
          mode="out-in"
        >
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <PlayerBar />
  </div>
</template>

<style scoped>
.page-enter-active,
.page-leave-active {
  transition: opacity 0.12s ease;
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
}
</style>
