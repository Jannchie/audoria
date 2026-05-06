<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import AudoriaLogo from './components/AudoriaLogo.vue'
import ContextMenu from './components/ContextMenu.vue'
import InputPromptDialog from './components/InputPromptDialog.vue'
import PlayerBar from './components/PlayerBar.vue'
import QueueDrawer from './components/QueueDrawer.vue'
import { useKeyboardDetect } from './composables/useKeyboardDetect'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import LoginPage from './pages/LoginPage.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { status, isGuest, check } = useAuth()

onMounted(() => {
  check()
})

useKeyboardShortcuts()
useMediaSession()
const { isKeyboardOpen } = useKeyboardDetect()

const authReady = computed(() => status.value !== 'loading')

const allNavItems = [
  { name: t('nav.library'), path: '/library', icon: 'i-tabler-vinyl' },
  { name: t('nav.playlists'), path: '/playlists', icon: 'i-tabler-playlist' },
  { name: t('nav.explore'), path: '/import', icon: 'i-tabler-compass' },
  { name: t('nav.parse'), path: '/parse', icon: 'i-tabler-link' },
  { name: t('nav.upload'), path: '/upload', icon: 'i-tabler-upload' },
  { name: t('nav.player'), path: '/player', icon: 'i-tabler-wave-sine' },
  { name: t('nav.settings'), path: '/settings', icon: 'i-tabler-settings' },
]

const restrictedPaths: Set<string> = new Set(GUEST_RESTRICTED_PATHS)

const loginNavItem = { name: t('nav.login'), path: '/login', icon: 'i-tabler-login' }

const navItems = computed(() => {
  if (isGuest.value) {
    return [
      ...allNavItems.filter(item => !restrictedPaths.has(item.path)),
      loginNavItem,
    ]
  }
  return allNavItems
})

// Mobile tabs
const allMobileNavItems = [
  { name: t('nav.library'), path: '/library', icon: 'i-tabler-vinyl' },
  { name: t('nav.playlists'), path: '/playlists', icon: 'i-tabler-playlist' },
  { name: t('nav.explore'), path: '/import', icon: 'i-tabler-compass' },
  { name: t('nav.settings'), path: '/settings', icon: 'i-tabler-settings' },
]

const mobileNavItems = computed(() => {
  if (isGuest.value) {
    return [
      ...allMobileNavItems.filter(item => !restrictedPaths.has(item.path)),
      loginNavItem,
    ]
  }
  return allMobileNavItems
})

const currentPath = computed(() => route.path)
const isPlayerPage = computed(() => route.path === '/player')
const isLocked = useScrollLock(document.body)

const showSafeAreaFill = computed(() =>
  authReady.value && route.path !== '/login' && !isPlayerPage.value,
)

// Redirect guest users away from restricted routes once auth resolves
watch(
  [authReady, isGuest, () => route.path],
  ([ready, guest, path]) => {
    if (ready && guest && restrictedPaths.has(path)) {
      router.replace('/library')
    }
  },
)

watchEffect(() => {
  isLocked.value = isPlayerPage.value
})
</script>

<template>
  <!-- Safe area fill: fixed bg strip behind the status bar (non-player pages) -->
  <div
    v-if="showSafeAreaFill"
    class="safe-area-fill"
  />

  <!-- Auth loading -->
  <div
    v-if="!authReady"
    class="auth-loading"
  >
    <span
      class="i-tabler-loader-2 auth-loading-icon animate-spin"
      aria-hidden="true"
    />
  </div>

  <!-- Login page (full overlay, no app shell) -->
  <LoginPage v-else-if="route.path === '/login'" />

  <!-- App shell -->
  <div
    v-else
    class="app-shell"
  >
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
            :aria-current="currentPath.startsWith(item.path) ? 'page' : undefined"
          >
            <span
              :class="[item.icon]"
              aria-hidden="true"
            />
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

    <!-- Global context menu singleton -->
    <ContextMenu />

    <!-- Global playback queue drawer -->
    <QueueDrawer />

    <!-- Global input prompt dialog -->
    <InputPromptDialog />

    <!-- Mobile bottom tab bar (hidden on desktop, player page, and when keyboard is open) -->
    <nav
      v-show="!isPlayerPage && !isKeyboardOpen"
      class="mobile-tabs"
    >
      <div class="mobile-tabs-inner">
        <RouterLink
          v-for="item in mobileNavItems"
          :key="item.path"
          class="mobile-tab"
          :class="{ 'mobile-tab--active': currentPath.startsWith(item.path) }"
          :to="item.path"
          :aria-current="currentPath.startsWith(item.path) ? 'page' : undefined"
        >
          <span
            class="mobile-tab-indicator"
            aria-hidden="true"
          />
          <span
            class="mobile-tab-icon"
            :class="[item.icon]"
            aria-hidden="true"
          />
          <span class="mobile-tab-label">{{ item.name }}</span>
        </RouterLink>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.safe-area-fill {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: env(safe-area-inset-top, 0px);
  background: var(--bg-base);
  z-index: 9;
  pointer-events: none;
}

.auth-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-base);
}

.auth-loading-icon {
  font-size: 2rem;
  color: var(--text-tertiary);
}

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
  padding-top: env(safe-area-inset-top, 0px);
}

@media (min-width: 768px) {
  .topbar {
    display: block;
  }
}

/* Floating/translucent mode on Player page — keeps sticky flow, only fades background/border */
.topbar--floating {
  background: transparent;
  border-bottom-color: transparent;
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
  font-family: var(--font-display);
  transition: color 0.25s ease;
}

.topbar--floating .logo-text {
  color: var(--text-secondary);
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
  color: rgba(255, 255, 255, 0.45);
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
  padding: 0 1rem calc(9rem + env(safe-area-inset-bottom, 0.5rem));
  padding-top: env(safe-area-inset-top, 0px);
}

@media (min-width: 768px) {
  .main-content {
    padding: 0 1.5rem 8rem;
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
/* Visually fused with PlayerBar above: shares the same surface, stacked
   into one solid control center with no divider. The fixed height keeps
   PlayerBar's `bottom` offset in sync with the actual tab bar height so
   the two stack flush instead of overlapping.

   Safe area uses native CSS env() for reliable iOS support. */
.mobile-tabs {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  box-sizing: border-box;
  height: calc(3.75rem + env(safe-area-inset-bottom, 0.5rem));
  padding: 0.25rem 0.5rem env(safe-area-inset-bottom, 0.5rem);
  background: var(--bg-primary);
}

@media (min-width: 768px) {
  .mobile-tabs {
    display: none;
  }
}

.mobile-tabs-inner {
  display: flex;
  align-items: stretch;
  height: 100%;
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
  top: 0;
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
  font-size: 0.65rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0.7;
  transition: opacity 0.2s ease;
  white-space: nowrap;
}

.mobile-tab--active .mobile-tab-label {
  opacity: 1;
  font-weight: 600;
}

/* When the virtual keyboard is open on iOS, hide mobile-tabs so they
   don't get pushed into view above the keyboard (position:fixed
   follows the visual viewport on iOS). */
body.keyboard-open .mobile-tabs {
  display: none !important;
}
</style>
