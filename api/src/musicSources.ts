export const musicDlSources = [
  'NeteaseMusicClient',
  'QQMusicClient',
  'KuwoMusicClient',
  'MiguMusicClient',
  'JamendoMusicClient',
] as const

export type MusicDlSource = (typeof musicDlSources)[number]

export const musicDlUrlSources = ['Bilibili', 'Youtube'] as const

export type MusicDlUrlSource = (typeof musicDlUrlSources)[number]

export function isMusicDlSource(value: string): value is MusicDlSource {
  return (musicDlSources as readonly string[]).includes(value)
}

export function isMusicDlUrlSource(value: string): value is MusicDlUrlSource {
  return (musicDlUrlSources as readonly string[]).includes(value)
}
