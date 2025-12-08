import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/library',
    },
    {
      path: '/upload',
      component: () => import('./pages/UploadPage.vue'),
    },
    {
      path: '/library',
      component: () => import('./pages/LibraryPage.vue'),
    },
    {
      path: '/player',
      component: () => import('./pages/PlayerPage.vue'),
    },
  ],
})

export default router
