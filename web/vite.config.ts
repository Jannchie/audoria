import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '..',
  plugins: [
    vue(),
    UnoCSS(),
    Components({
      dirs: ['./src/components'],
      dts: './src/components.d.ts',
    }),
    AutoImport({
      imports: [
        'vue',
        '@vueuse/core',
      ],
      dirs: [
        './src/composables',
      ],
      dts: './src/auto-import.d.ts',
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['audoria.svg'],
      manifest: {
        name: 'Audoria',
        short_name: 'Audoria',
        description: 'A modern music library and player',
        theme_color: '#0e0e10',
        background_color: '#0e0e10',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          // Standard PNG icons for Windows 11 / Edge compatibility
          { src: 'icon-48x48.png', sizes: '48x48', type: 'image/png', purpose: 'any' },
          { src: 'icon-72x72.png', sizes: '72x72', type: 'image/png', purpose: 'any' },
          { src: 'icon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
          { src: 'icon-128x128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
          { src: 'icon-144x144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
          { src: 'icon-150x150.png', sizes: '150x150', type: 'image/png', purpose: 'any' },
          { src: 'icon-152x152.png', sizes: '152x152', type: 'image/png', purpose: 'any' },
          { src: 'icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-256x256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
          { src: 'icon-384x384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
          { src: 'icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Maskable icons (solid background, content in safe zone)
          { src: 'icon-192x192.maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512x512.maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          // Fallback SVG
          { src: 'audoria.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 8788,
    strictPort: true,
    proxy: {
      '/api/v1': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
    },
  },
})
