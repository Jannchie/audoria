import { computed, watch } from 'vue'
import { resolveApiUrl, useMusicQuery } from './useMusic'
import { usePlaybackControls } from './usePlaybackControls'
import { usePlayerState } from './usePlayerState'

const mediaSeekStep = 10

export function useMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return
  }

  const { data: tracks } = useMusicQuery()
  const {
    currentTrackId,
    isPlaying,
    currentTime,
    duration,
    setPlaying,
  } = usePlayerState()
  const controls = usePlaybackControls()

  const currentTrack = computed(() => {
    const items = tracks.value ?? []
    if (!currentTrackId.value || items.length === 0) {
      return null
    }
    return items.find(item => item.id === currentTrackId.value) ?? null
  })

  const coverArtUrl = computed(() => {
    if (!currentTrack.value?.coverUrl) {
      return
    }
    return resolveApiUrl(currentTrack.value.coverUrl)
  })

  watch([currentTrack, coverArtUrl, isPlaying], () => {
    const track = currentTrack.value
    if (!track) {
      navigator.mediaSession.metadata = null
      return
    }

    const artwork: MediaImage[] = []
    if (coverArtUrl.value) {
      artwork.push({
        src: coverArtUrl.value,
        sizes: '512x512',
        type: 'image/jpeg',
      })
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || track.filename || '',
      artist: track.artists || '',
      album: track.album || '',
      artwork,
    })
  })

  watch([isPlaying, currentTime, duration], () => {
    if (duration.value > 0) {
      navigator.mediaSession.setPositionState({
        duration: duration.value,
        playbackRate: 1,
        position: currentTime.value,
      })
    }
  })

  navigator.mediaSession.setActionHandler('play', () => {
    setPlaying(true)
  })
  navigator.mediaSession.setActionHandler('pause', () => {
    setPlaying(false)
  })
  navigator.mediaSession.setActionHandler('previoustrack', () => {
    controls.previous()
  })
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    controls.next()
  })
  // requestSeek (via controls) moves the <audio> element; seekTo alone only
  // updated the stored position.
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null) {
      controls.seekTo(details.seekTime)
    }
  })
  try {
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      controls.seekBy(-(details.seekOffset ?? mediaSeekStep))
    })
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      controls.seekBy(details.seekOffset ?? mediaSeekStep)
    })
  }
  catch {
    // Older browsers throw for unsupported actions.
  }
}
