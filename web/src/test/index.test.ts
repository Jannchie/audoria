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
      muted: true,
      playMode: 'shuffle',
      volume: 0.35,
    }))

    const { usePlayerState } = await loadPlayerState()
    const player = usePlayerState()

    expect(player.currentTrackId.value).toBe('track-b')
    expect(player.currentTime.value).toBe(42)
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
})
