import { createRouter, createWebHistory } from 'vue-router'

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
      path: '/library',
      name: 'library',
      component: () => import('./pages/LibraryPage.vue'),
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
      path: '/player',
      name: 'player',
      component: () => import('./pages/PlayerPage.vue'),
    },
  ],
})

export default router
