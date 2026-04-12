import { ref } from 'vue'

const currentTrackId = ref<string | null>(null)
const isPlaying = ref(false)
const shuffle = ref(false)
const repeatMode = ref<'all' | 'one' | 'off'>('all')
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

  const toggleShuffle = () => {
    shuffle.value = !shuffle.value
  }

  const cycleRepeat = () => {
    if (repeatMode.value === 'all') {
      repeatMode.value = 'one'
    }
    else if (repeatMode.value === 'one') {
      repeatMode.value = 'off'
    }
    else {
      repeatMode.value = 'all'
    }
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

  return {
    currentTrackId,
    isPlaying,
    shuffle,
    repeatMode,
    currentTime,
    duration,
    volume,
    muted,
    selectTrack,
    setPlaying,
    toggleShuffle,
    cycleRepeat,
    updateProgress,
    seekTo,
    setVolume,
    toggleMute,
  }
}
