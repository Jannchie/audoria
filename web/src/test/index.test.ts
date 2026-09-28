import { beforeEach, describe, expect, it, vi } from 'vitest'

const playerStateStorageKey = 'audoria.player-state'

class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

async function loadPlayerState() {
  vi.resetModules()
  return await import('../composables/usePlayerState')
}

describe('useplayerstate', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
  })

  it('restores the last track and progress from persisted state', async () => {
    globalThis.localStorage.setItem(playerStateStorageKey, JSON.stringify({
      context: {
        type: 'library',
        trackIds: ['track-a', 'track-b'],
      },
      currentTime: 42,
      currentTrackId: 'track-b',
      history: ['track-a'],
      isPlaying: true,
      muted: true,
      playMode: 'shuffle',
      volume: 0.35,
    }))

    const { usePlayerState } = await loadPlayerState()
    const player = usePlayerState()

    expect(player.currentTrackId.value).toBe('track-b')
    expect(player.currentTime.value).toBe(42)
    expect(player.isPlaying.value).toBe(true)
    expect(player.playMode.value).toBe('shuffle')
    expect(player.volume.value).toBe(0.35)
    expect(player.muted.value).toBe(true)
    expect(player.getResumeTime(120)).toBe(42)
    expect(player.getResumeTime(45)).toBe(0)
  })

  it('prefers playback history when going to the previous track', async () => {
    const { usePlayerState } = await loadPlayerState()
    const player = usePlayerState()
    const tracks = [{ id: 'track-a' }, { id: 'track-b' }, { id: 'track-c' }]

    player.selectTrack('track-a', { contextTracks: tracks })
    player.selectTrack('track-b', { contextTracks: tracks })
    player.selectTrack('track-c', { contextTracks: tracks })

    expect(player.playHistory.value).toEqual(['track-a', 'track-b'])

    const previousTrack = player.getPreviousTrackId(tracks)

    expect(previousTrack).toBe('track-b')
    expect(player.playHistory.value).toEqual(['track-a'])

    player.selectTrack(previousTrack, { contextTracks: tracks, history: 'skip' })
    expect(player.currentTrackId.value).toBe('track-b')
  })

  it('falls back to the current order when the history is empty', async () => {
    const { usePlayerState } = await loadPlayerState()
    const player = usePlayerState()
    const tracks = [{ id: 'track-a' }, { id: 'track-b' }, { id: 'track-c' }]

    player.selectTrack('track-b', { contextTracks: tracks, history: 'skip' })

    const previousTrack = player.getPreviousTrackId(tracks)

    expect(previousTrack).toBe('track-a')
  })

  it('persists the playback status when toggled', async () => {
    const { usePlayerState } = await loadPlayerState()
    const player = usePlayerState()

    player.setPlaying(true)

    const persisted = JSON.parse(globalThis.localStorage.getItem(playerStateStorageKey) ?? '{}') as { isPlaying?: boolean }
    expect(persisted.isPlaying).toBe(true)
  })

  it('consumes only one queued duplicate when selecting up next', async () => {
    const { usePlayerState } = await loadPlayerState()
    const player = usePlayerState()

    player.enqueueLast(['track-a', 'track-a', 'track-b'])
    player.selectTrack('track-a', { consumeUpNext: true })

    expect(player.upNextQueue.value).toEqual(['track-a', 'track-b'])
  })

  it('returns queued tracks before adjacent context tracks', async () => {
    const { usePlayerState } = await loadPlayerState()
    const player = usePlayerState()
    const tracks = [{ id: 'track-a' }, { id: 'track-b' }, { id: 'track-c' }]

    player.selectTrack('track-a', { contextTracks: tracks, history: 'skip' })
    player.enqueueLast(['track-c'])

    expect(player.getNextTrackId(tracks)).toBe('track-c')
  })

  it('shifts lrc timestamps in the lyrics text', async () => {
    const { shiftLrcTimestamps } = await import('../composables/useLyrics')

    expect(shiftLrcTimestamps('[00:10.00]First\n[00:00.05]Intro', -100))
      .toBe('[00:09.900]First\n[00:00.000]Intro')
    expect(shiftLrcTimestamps('[00:10][00:12.50]Echo', 250))
      .toBe('[00:10.250][00:12.750]Echo')
  })

  it('folds lines sharing a timestamp into translations', async () => {
    const { parseLrc } = await import('../composables/useLyrics')

    const lines = parseLrc([
      '[ti:机さする]',
      '[00:07.88]外を見るともう明るいよね',
      '[00:07.88]望向窗外发现天色已经亮了',
      '[00:16.39]眠れなかったけどさ頭冴えてる',
      '[00:16.39]',
      '[00:16.39]眠れなかったけどさ頭冴えてる',
    ].join('\n'))

    expect(lines).toEqual([
      { time: 7.88, text: '外を見るともう明るいよね', translations: ['望向窗外发现天色已经亮了'] },
      { time: 16.39, text: '眠れなかったけどさ頭冴えてる', translations: [] },
    ])
  })

  it('expands lines prefixed with several timestamps', async () => {
    const { parseLrc } = await import('../composables/useLyrics')

    expect(parseLrc('[00:30.00][00:10.00]Chorus\n[00:20.00]Verse').map(line => [line.time, line.text]))
      .toEqual([[10, 'Chorus'], [20, 'Verse'], [30, 'Chorus']])
  })

  it('resolves the current lyric line from lrc timestamps', async () => {
    const { usePlayerState } = await loadPlayerState()
    const { useLyrics } = await import('../composables/useLyrics')
    const player = usePlayerState()
    const lyrics = useLyrics(() => '[00:10.00]First\n[00:12.00]Second')

    player.updateProgress(11, 120)
    expect(lyrics.currentLineIndex.value).toBe(0)

    player.updateProgress(13, 120)
    expect(lyrics.currentLineIndex.value).toBe(1)
  })

  it('keeps playlist contexts isolated when syncing track order', async () => {
    globalThis.localStorage.setItem(playerStateStorageKey, JSON.stringify({
      context: {
        type: 'playlist',
        playlistId: 'playlist-a',
        trackIds: ['track-a', 'track-b'],
      },
      currentTrackId: 'track-a',
    }))

    const { usePlayerState } = await loadPlayerState()
    const player = usePlayerState()

    player.syncTrackContext(
      [{ id: 'track-c' }, { id: 'track-d' }],
      { type: 'playlist', playlistId: 'playlist-b' },
    )

    expect(player.playbackContext.value).toEqual({
      type: 'playlist',
      playlistId: 'playlist-a',
      trackIds: ['track-a', 'track-b'],
    })
  })
})
