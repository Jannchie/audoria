import type { MusicDlSource } from '../api/types.gen'

const sourceDisplayMap = {
  NeteaseMusicClient: { label: 'Netease', icon: 'i-tabler-brand-netease-music' },
  QQMusicClient: { label: 'QQ', icon: 'i-arcticons-qq-music' },
  KuwoMusicClient: { label: 'Kuwo', icon: 'i-tabler-disc' },
  MiguMusicClient: { label: 'Migu', icon: 'i-arcticons-migu' },
  JamendoMusicClient: { label: 'Jamendo', icon: 'i-arcticons-jamendo' },
} satisfies Record<MusicDlSource, { label: string, icon: string }>

export function isKnownSource(value: string): value is MusicDlSource {
  return value in sourceDisplayMap
}

export function getSourceDisplay(source: string | null | undefined): { label: string, icon: string } {
  if (source && isKnownSource(source)) {
    return sourceDisplayMap[source]
  }
  return {
    label: source || 'Unknown',
    icon: 'i-tabler-world',
  }
}
