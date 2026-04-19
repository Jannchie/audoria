import { ref } from 'vue'

export type PlayMode = 'sequence' | 'repeat-all' | 'repeat-one' | 'shuffle'

interface TrackLike {
  id: string
}

const playModeOrder: PlayMode[] = ['sequence', 'repeat-all', 'repeat-one', 'shuffle']

const currentTrackId = ref<string | null>(null)
const isPlaying = ref(false)
const playMode = ref<PlayMode>('repeat-all')
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const muted = ref(false)

export function usePlayerState() {
  const selectTrack = (id: string | null) => {
    currentTrackId.value = id
  }

  const setPlaying = (playing: boolean) => {
    isPlaying.value = playing
  }

  const cyclePlayMode = () => {
    const index = playModeOrder.indexOf(playMode.value)
    playMode.value = playModeOrder[(index + 1) % playModeOrder.length]
  }

  const updateProgress = (time: number, total: number) => {
    currentTime.value = time
    duration.value = total
  }

  const seekTo = (time: number) => {
    currentTime.value = time
  }

  const setVolume = (v: number) => {
    volume.value = Math.min(1, Math.max(0, v))
    if (volume.value > 0) {
      muted.value = false
    }
  }

  const toggleMute = () => {
    muted.value = !muted.value
  }

  const pickRandomTrackId = (tracks: TrackLike[]) => {
    const others = tracks.filter(track => track.id !== currentTrackId.value)
    const pool = others.length > 0 ? others : tracks
    return pool[Math.floor(Math.random() * pool.length)]?.id ?? null
  }

  const getAdjacentTrackId = (tracks: TrackLike[], direction: 'next' | 'prev') => {
    if (tracks.length === 0) {
      return null
    }
    if (playMode.value === 'shuffle') {
      return pickRandomTrackId(tracks)
    }
    const index = tracks.findIndex(track => track.id === currentTrackId.value)
    if (index === -1) {
      return tracks[0]?.id ?? null
    }
    const nextIndex = direction === 'next' ? index + 1 : index - 1
    const nextTrack = tracks[nextIndex]
    if (nextTrack) {
      return nextTrack.id
    }
    if (playMode.value === 'repeat-all') {
      return direction === 'next'
        ? tracks[0]?.id ?? null
        : tracks.at(-1)?.id ?? null
    }
    return null
  }

  const getAutoAdvanceTrackId = (tracks: TrackLike[]) => {
    if (playMode.value === 'repeat-one') {
      return currentTrackId.value
    }
    return getAdjacentTrackId(tracks, 'next')
  }

  return {
    currentTrackId,
    isPlaying,
    playMode,
    currentTime,
    duration,
    volume,
    muted,
    selectTrack,
    setPlaying,
    cyclePlayMode,
    updateProgress,
    seekTo,
    setVolume,
    toggleMute,
    getAdjacentTrackId,
    getAutoAdvanceTrackId,
  }
}
