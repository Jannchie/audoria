import presetIcons from '@unocss/preset-icons'
import { defineConfig, presetWind4 } from 'unocss'

export default defineConfig({
  content: {
    pipeline: {
      // Composables pick icons for menus and toasts in plain .ts files.
      include: [/\.vue($|\?)/, /src[\\/](composables|utils)[\\/].*\.ts$/],
    },
  },
  safelist: [
    'i-simple-icons-neteasecloudmusic',
    'i-simple-icons-qq',
    'i-simple-icons-bilibili',
    'i-simple-icons-youtube',
    'i-jannchie-disc',
    'i-arcticons-migu',
    'i-arcticons-jamendo',
    'i-jannchie-globe',
  ],
  presets: [
    presetIcons({
      collections: {
        // Bold (1.5) keeps 16–20px UI icons about as heavy as the old 2px Tabler set.
        jannchie: () => import('@jannchie/iconify-json/bold.json').then(m => m.default),
      },
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
    presetWind4(),
  ],
  shortcuts: {
    'btn-ghost': 'rounded-xl transition-all text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:scale-95',
    'text-heading': 'font-[Outfit,DM_Sans,system-ui,sans-serif]',
  },
})
