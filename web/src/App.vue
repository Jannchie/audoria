<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import AudoriaLogo from './components/AudoriaLogo.vue'
import PlayerBar from './components/PlayerBar.vue'

const route = useRoute()

const navItems = [
  { name: 'Library', path: '/library', icon: 'i-tabler-vinyl' },
  { name: 'Explore', path: '/import', icon: 'i-tabler-compass' },
  { name: 'Upload', path: '/upload', icon: 'i-tabler-upload' },
  { name: 'Player', path: '/player', icon: 'i-tabler-wave-sine' },
]

const currentPath = computed(() => route.path)
const isPlayerPage = computed(() => route.path === '/player')
</script>

<template>
  <div class="app-shell">
    <!-- Desktop top bar (hidden on mobile) -->
    <header
      class="topbar"
      :class="{ 'topbar--floating': isPlayerPage }"
    >
      <div class="topbar-inner">
        <RouterLink
          to="/"
          class="logo-link flex gap-2.5 items-center"
        >
          <AudoriaLogo :size="32" />
          <span class="logo-text">
            Audoria
          </span>
        </RouterLink>

        <nav class="desktop-nav">
          <RouterLink
            v-for="item in navItems"
            :key="item.path"
            class="desktop-nav-item"
            :class="{ 'desktop-nav-item--active': currentPath.startsWith(item.path) }"
            :to="item.path"
          >
            <span :class="[item.icon]" />
            <span>{{ item.name }}</span>
          </RouterLink>
        </nav>
      </div>
    </header>

    <!-- Main content -->
    <main
      class="main-content"
      :class="{ 'main-content--player': isPlayerPage }"
    >
      <RouterView />
    </main>

    <!-- Player bar -->
    <PlayerBar />

    <!-- Mobile bottom tab bar (hidden on desktop and player page) -->
    <nav
      v-show="!isPlayerPage"
      class="mobile-tabs"
    >
      <div class="mobile-tabs-inner">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          class="mobile-tab"
          :class="{ 'mobile-tab--active': currentPath.startsWith(item.path) }"
          :to="item.path"
        >
          <span class="mobile-tab-indicator" />
          <span
            class="mobile-tab-icon"
            :class="[item.icon]"
          />
          <span class="mobile-tab-label">{{ item.name }}</span>
        </RouterLink>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
}

/* ---- Top bar: desktop only ---- */
.topbar {
  display: none;
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
  transition: background 0.3s ease, border-color 0.3s ease;
}

@media (min-width: 768px) {
  .topbar {
    display: block;
  }
}

/* Floating/translucent mode on Player page — integrates with shader background */
.topbar--floating {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: transparent;
  border-bottom: none;
}

.topbar-inner {
  max-width: 80rem;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 3.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo-link {
  text-decoration: none;
}

.logo-text {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
  transition: color 0.25s ease;
}

.topbar--floating .logo-text {
  color: rgba(255, 255, 255, 0.82);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
}

.desktop-nav {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.desktop-nav-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.875rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  transition: all 0.15s ease;
  text-decoration: none;
}

.desktop-nav-item:hover {
  color: var(--text-secondary);
  background: var(--bg-surface);
}

.desktop-nav-item--active {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.desktop-nav-item--active:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.topbar--floating .desktop-nav-item {
  color: rgba(255, 255, 255, 0.58);
}

.topbar--floating .desktop-nav-item:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.08);
}

.topbar--floating .desktop-nav-item--active {
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.topbar--floating .desktop-nav-item--active:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* ---- Main content ---- */
.main-content {
  flex: 1;
  max-width: 80rem;
  width: 100%;
  margin: 0 auto;
  /* mobile: bottom padding for PlayerBar + tabs */
  padding: 0 1rem 10.5rem;
}

@media (min-width: 768px) {
  .main-content {
    padding: 1.25rem 1.5rem 8rem;
  }
}

.main-content--player {
  padding: 0;
  overflow: hidden;
  max-width: none;
}

@media (min-width: 768px) {
  .main-content--player {
    padding: 0;
  }
}

/* ---- Mobile bottom tab bar ---- */
.mobile-tabs {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  padding: 0.5rem 0.75rem calc(0.5rem + env(safe-area-inset-bottom, 0));
  background: rgba(20, 20, 22, 0.72);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

@media (min-width: 768px) {
  .mobile-tabs {
    display: none;
  }
}

.mobile-tabs-inner {
  display: flex;
  align-items: stretch;
}

.mobile-tab {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.375rem 0;
  color: var(--text-tertiary);
  text-decoration: none;
  transition: color 0.2s ease, transform 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.mobile-tab:active {
  transform: scale(0.92);
}

.mobile-tab--active {
  color: var(--accent);
}

.mobile-tab-indicator {
  position: absolute;
  top: -0.5rem;
  left: 50%;
  transform: translateX(-50%) scaleX(0);
  width: 1.25rem;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.mobile-tab--active .mobile-tab-indicator {
  transform: translateX(-50%) scaleX(1);
}

.mobile-tab-icon {
  font-size: 1.375rem;
  transition: transform 0.2s ease;
}

.mobile-tab--active .mobile-tab-icon {
  transform: translateY(-1px);
}

.mobile-tab-label {
  font-size: 0.6rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  opacity: 0.7;
  transition: opacity 0.2s ease;
}

.mobile-tab--active .mobile-tab-label {
  opacity: 1;
  font-weight: 600;
}
</style>
