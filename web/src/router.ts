import { h } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { authStatus, GUEST_RESTRICTED_PATHS } from './composables/useAuth'

const scrollPositions = new Map<string, { left: number, top: number }>()

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, savedPosition) {
    if (from.fullPath) {
      scrollPositions.set(from.fullPath, {
        left: window.scrollX,
        top: window.scrollY,
      })
    }

    if (savedPosition) {
      return savedPosition
    }

    return scrollPositions.get(to.fullPath) ?? { left: 0, top: 0 }
  },
  routes: [
    {
      path: '/',
      redirect: '/library',
    },
    {
      path: '/login',
      name: 'login',
      component: { render: () => h('div') },
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('./pages/LibraryPage.vue'),
    },
    {
      path: '/playlists',
      name: 'playlists',
      component: () => import('./pages/PlaylistListPage.vue'),
    },
    {
      path: '/playlists/:id',
      name: 'playlist-detail',
      component: () => import('./pages/PlaylistDetailPage.vue'),
    },
    {
      path: '/upload',
      name: 'upload',
      component: () => import('./pages/UploadPage.vue'),
    },
    {
      path: '/import',
      name: 'import',
      component: () => import('./pages/ImportPage.vue'),
    },
    {
      path: '/parse',
      name: 'parse',
      component: () => import('./pages/ParsePage.vue'),
    },
    {
      path: '/player',
      name: 'player',
      component: () => import('./pages/PlayerPage.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./pages/SettingsPage.vue'),
    },
  ],
})

router.beforeEach((_to) => {
  if (authStatus.value === 'guest' && GUEST_RESTRICTED_PATHS.some(path => _to.path.startsWith(path))) {
    return '/library'
  }
  if (authStatus.value === 'authenticated' && _to.path === '/login') {
    return '/library'
  }
})

export default router
