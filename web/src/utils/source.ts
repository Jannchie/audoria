import type { MusicDlSource } from '../api/types.gen'
import { translate } from '../i18n'

export interface SourceDisplay {
  accent: string
  icon: string
  label: string
}

const sourceDisplayMap = {
  NeteaseMusicClient: { label: 'Netease', icon: 'i-simple-icons-neteasecloudmusic', accent: '#d43c33' },
  QQMusicClient: { label: 'QQ', icon: 'i-simple-icons-qq', accent: '#12b7f5' },
  KuwoMusicClient: { label: 'Kuwo', icon: 'i-tabler-disc', accent: '#f59e0b' },
  MiguMusicClient: { label: 'Migu', icon: 'i-arcticons-migu', accent: '#60a5fa' },
  JamendoMusicClient: { label: 'Jamendo', icon: 'i-arcticons-jamendo', accent: '#f472b6' },
} satisfies Record<MusicDlSource, SourceDisplay>

export function isKnownSource(value: string): value is MusicDlSource {
  return value in sourceDisplayMap
}

export function getSourceDisplay(source: string | null | undefined): SourceDisplay {
  if (source && isKnownSource(source)) {
    return sourceDisplayMap[source]
  }
  if (source === 'Bilibili') {
    return {
      accent: '#8e8e99',
      icon: 'i-simple-icons-bilibili',
      label: 'Bilibili',
    }
  }
  if (source === 'Youtube') {
    return {
      accent: '#8e8e99',
      icon: 'i-simple-icons-youtube',
      label: 'YouTube',
    }
  }
  return {
    accent: '#8e8e99',
    icon: 'i-tabler-world',
    label: source || translate('common.unknown'),
  }
}
