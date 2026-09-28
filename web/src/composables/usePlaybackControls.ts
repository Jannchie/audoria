import type { PlayMode } from './usePlayerState'
import { computed } from 'vue'
import { useMusicQuery } from './useMusic'
import { usePlayerState } from './usePlayerState'

const repeatCycle: PlayMode[] = ['sequence', 'repeat-all', 'repeat-one']
let lastLinearMode: PlayMode = 'repeat-all'

/**
 * State-driven playback actions shared by keyboard shortcuts and the
 * Media Session. PlayerBar owns the <audio> element and reacts to the
 * player state (isPlaying, seekTarget, volume), so nothing here touches it.
 */
export function usePlaybackControls() {
  const { data: tracks } = useMusicQuery()
  const {
    currentTime,
    currentTrackId,
    duration,
    getNextTrackId,
    getPreviousTrackId,
    isPlaying,
    muted,
    playMode,
    playbackContext,
    requestSeek,
    selectTrack,
    setPlayMode,
    setPlaying,
    setVolume,
    toggleMute,
    upNextQueue,
    volume,
  } = usePlayerState()

  const allTracks = computed(() => tracks.value ?? [])

  // Mirrors PlayerBar: with nothing selected yet, the first track of the
  // current context (or the library) is what "play" starts.
  const resolvedTrackId = computed(() => {
    const items = allTracks.value
    if (items.length === 0) {
      return null
    }
    if (currentTrackId.value) {
      return items.some(item => item.id === currentTrackId.value) ? currentTrackId.value : null
    }
    const available = new Set(items.map(item => item.id))
    const fromContext = (playbackContext.value?.trackIds ?? []).find(id => available.has(id))
    return fromContext ?? items[0].id
  })

  const hasTrack = computed(() => resolvedTrackId.value !== null)

  function togglePlay(): boolean {
    if (!resolvedTrackId.value) {
      return false
    }
    if (!currentTrackId.value) {
      selectTrack(resolvedTrackId.value, { contextTracks: allTracks.value })
    }
    setPlaying(!isPlaying.value)
    return true
  }

  function next(): boolean {
    const nextId = getNextTrackId(allTracks.value)
    if (!nextId) {
      return false
    }
    const isUpNext = upNextQueue.value[0] === nextId
    selectTrack(nextId, { contextTracks: allTracks.value, consumeUpNext: isUpNext })
    setPlaying(true)
    return true
  }

  function previous(): boolean {
    const prevId = getPreviousTrackId(allTracks.value)
    if (!prevId) {
      return false
    }
    selectTrack(prevId, { contextTracks: allTracks.value, history: 'skip' })
    setPlaying(true)
    return true
  }

  function seekTo(seconds: number): boolean {
    const total = duration.value
    if (!total) {
      return false
    }
    requestSeek(Math.min(Math.max(0, seconds), Math.max(0, total - 0.25)))
    return true
  }

  function seekBy(deltaSeconds: number): boolean {
    return seekTo(currentTime.value + deltaSeconds)
  }

  function seekToRatio(ratio: number): boolean {
    return seekTo(Math.min(1, Math.max(0, ratio)) * duration.value)
  }

  /** Returns the new effective volume (0..1). */
  function adjustVolume(delta: number): number {
    const base = muted.value ? 0 : volume.value
    const nextVolume = Math.round(Math.min(1, Math.max(0, base + delta)) * 100) / 100
    setVolume(nextVolume)
    return nextVolume
  }

  /** Toggle shuffle on/off, restoring the previous repeat mode when leaving it. */
  function toggleShuffle(): PlayMode {
    if (playMode.value === 'shuffle') {
      setPlayMode(lastLinearMode)
    }
    else {
      lastLinearMode = playMode.value
      setPlayMode('shuffle')
    }
    return playMode.value
  }

  /** Cycle sequence → repeat all → repeat one. Leaves shuffle for repeat all. */
  function cycleRepeat(): PlayMode {
    const index = repeatCycle.indexOf(playMode.value)
    const nextMode = index === -1 ? 'repeat-all' : repeatCycle[(index + 1) % repeatCycle.length]
    setPlayMode(nextMode)
    lastLinearMode = nextMode
    return nextMode
  }

  return {
    adjustVolume,
    cycleRepeat,
    hasTrack,
    isPlaying,
    muted,
    next,
    playMode,
    previous,
    seekBy,
    seekTo,
    seekToRatio,
    toggleMute,
    togglePlay,
    toggleShuffle,
    volume,
  }
}
