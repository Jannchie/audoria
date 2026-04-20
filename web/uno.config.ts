import presetIcons from '@unocss/preset-icons'
import { defineConfig, presetWind4 } from 'unocss'

export default defineConfig({
  safelist: [
    'i-simple-icons-neteasecloudmusic',
    'i-simple-icons-qq',
    'i-simple-icons-bilibili',
    'i-simple-icons-youtube',
    'i-tabler-disc',
    'i-arcticons-migu',
    'i-arcticons-jamendo',
    'i-tabler-world',
  ],
  presets: [
    presetIcons({
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
