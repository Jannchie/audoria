import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/library',
    },
    {
      path: '/library',
      component: () => import('./pages/LibraryPage.vue'),
    },
    {
      path: '/upload',
      component: () => import('./pages/UploadPage.vue'),
    },
    {
      path: '/import',
      component: () => import('./pages/ImportPage.vue'),
    },
    {
      path: '/player',
      component: () => import('./pages/PlayerPage.vue'),
    },
  ],
})

export default router
