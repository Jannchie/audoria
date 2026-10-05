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

  it('turns a lyrics document into lines with their translations', async () => {
    const { linesFromDoc } = await import('../composables/useLyrics')

    expect(linesFromDoc({
      version: 1,
      timing: 'line',
      cues: [
        { id: 'c0', begin: 7880, words: [{ text: '外を見る' }], ruby: [{ start: 0, end: 1, reading: 'そと' }] },
        { id: 'c1', begin: 16_390, words: [] },
      ],
      tracks: [{ lang: 'zh', kind: 'translation', lines: { c0: '望向窗外' } }],
    })).toEqual([
      { id: 'c0', time: 7.88, text: '外を見る', words: [{ text: '外を見る' }], background: [], wordTimed: false, translations: ['望向窗外'] },
      { id: 'c1', time: 16.39, text: '', words: [], background: [], wordTimed: false, translations: [] },
    ])
    expect(linesFromDoc({ version: 1, timing: 'none', cues: [], tracks: [] })).toBeNull()
  })

  it('cuts furigana segments at word boundaries and shares a cut word\'s time by length', async () => {
    const { layoutLyricLine } = await import('../composables/useLyrics')
    const words = [{ text: '運', begin: 0, end: 100 }, { text: '命の', begin: 100, end: 300 }]

    expect(layoutLyricLine(words, [{ text: '運命', ruby: 'さだめ' }, { text: 'の' }])).toEqual([
      {
        index: 0,
        segment: { text: '運命', ruby: 'さだめ' },
        pieces: [{ text: '運', begin: 0, end: 100 }, { text: '命', begin: 100, end: 200 }],
        begin: 0,
        end: 200,
      },
      { index: 1, segment: { text: 'の' }, pieces: [{ text: 'の', begin: 200, end: 300 }], begin: 200, end: 300 },
    ])
    // Readings for older text are ignored rather than misplaced.
    expect(layoutLyricLine(words, [{ text: '別', ruby: 'べつ' }]).map(chunk => chunk.segment))
      .toEqual([{ text: '運命の' }])
  })

  it('smooths stepped playback time without running ahead of a stall or stepping back', async () => {
    const { createPlaybackClock } = await import('../composables/usePlaybackClock')
    let now = 0
    const clock = createPlaybackClock(() => now)

    clock.report(10, true)
    now = 200
    expect(clock.read()).toBeCloseTo(10.2)
    now = 2000
    expect(clock.read()).toBeCloseTo(10.5)
    clock.report(10.4, true)
    expect(clock.read()).toBeCloseTo(10.5)
    clock.report(3, true)
    expect(clock.read()).toBe(3)
    clock.report(3, false)
    now = 5000
    expect(clock.read()).toBe(3)
  })

  it('writes a corrected reading into every cue with the same text and readings', async () => {
    const { applyReadingCorrection } = await import('../composables/useFurigana')
    const ruby = [{ start: 0, end: 2, reading: 'さだめ' }]
    const doc = {
      version: 1 as const,
      timing: 'line' as const,
      cues: [
        { id: 'c0', begin: 1000, words: [{ text: '運命の今' }], ruby },
        { id: 'c1', begin: 30_000, words: [{ text: '運命の今' }], ruby },
        { id: 'c2', begin: 40_000, words: [{ text: '運命の今' }] },
      ],
      tracks: [],
    }
    const segments = [
      { text: '運命', ruby: 'さだめ', explicit: true },
      { text: 'の' },
      { text: '今', ruby: 'こん' },
    ]

    const corrected = applyReadingCorrection(doc, 'c0', segments, 2, ' いま ')
    expect(corrected.cues.map(cue => cue.ruby)).toEqual([
      [...ruby, { start: 3, end: 4, reading: 'いま' }],
      [...ruby, { start: 3, end: 4, reading: 'いま' }],
      undefined,
    ])
    expect(applyReadingCorrection(doc, 'c0', segments, 0, '').cues.map(cue => cue.ruby))
      .toEqual([undefined, undefined, undefined])
  })

  it('resolves the current lyric line from cue times', async () => {
    const { usePlayerState } = await loadPlayerState()
    const { useLyrics } = await import('../composables/useLyrics')
    const player = usePlayerState()
    const lyrics = useLyrics(() => ({
      version: 1,
      timing: 'line',
      cues: [{ id: 'a', begin: 10_000, words: [{ text: 'First' }] }, { id: 'b', begin: 12_000, words: [{ text: 'Second' }] }],
      tracks: [],
    }))

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
