import { computed, watch } from 'vue'
import { resolveApiUrl, useMusicQuery } from './useMusic'
import { usePlayerState } from './usePlayerState'

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
    seekTo,
    selectTrack,
    getNextTrackId,
    getPreviousTrackId,
  } = usePlayerState()

  const currentTrack = computed(() => {
    const items = tracks.value ?? []
    if (!currentTrackId.value || items.length === 0) {
      return null
    }
    return items.find(item => item.id === currentTrackId.value) ?? null
  })

  const coverArtUrl = computed(() => {
    if (!currentTrack.value?.coverUrl) {
      return undefined
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
    const prevId = getPreviousTrackId(tracks.value ?? [])
    if (prevId) {
      selectTrack(prevId, { contextTracks: tracks.value ?? [], history: 'skip' })
      setPlaying(true)
    }
  })
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    const nextId = getNextTrackId(tracks.value ?? [])
    if (nextId) {
      selectTrack(nextId, { contextTracks: tracks.value ?? [], consumeUpNext: true })
      setPlaying(true)
    }
  })
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null) {
      seekTo(details.seekTime)
    }
  })
}
