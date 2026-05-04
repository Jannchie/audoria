import { onKeyStroke } from '@vueuse/core'
import { useMusicQuery } from './useMusic'
import { usePlayerState } from './usePlayerState'

/**
 * Registers global keyboard shortcuts for music playback controls.
 *
 * Space        – toggle play/pause (skipped when focus is inside input/textarea)
 * Ctrl+←       – previous track
 * Ctrl+→       – next track
 * ↑            – volume +0.05
 * ↓            – volume –0.05
 * M            – toggle mute
 */
export function useKeyboardShortcuts(): void {
  const { data: tracks } = useMusicQuery()
  const {
    currentTrackId,
    setPlaying,
    selectTrack,
    volume,
    setVolume,
    toggleMute,
    getNextTrackId,
    getPreviousTrackId,
    upNextQueue,
  } = usePlayerState()

  function isEditableTarget(el: EventTarget | null): boolean {
    if (!el || !(el instanceof HTMLElement)) {
      return false
    }
    const tag = el.tagName.toLowerCase()
    return tag === 'input'
      || tag === 'textarea'
      || tag === 'select'
      || el.isContentEditable
      || el.getAttribute('role') === 'textbox'
  }

  function getAudioElement(): HTMLAudioElement | null {
    return document.querySelector('audio')
  }

  function togglePlayPause(): void {
    const audio = getAudioElement()
    if (!audio) {
      return
    }
    if (audio.paused) {
      if (!currentTrackId.value) {
        return
      }
      audio.play().then(() => setPlaying(true)).catch(() => {})
    }
    else {
      audio.pause()
      setPlaying(false)
    }
  }

  function handleNext(): void {
    const allTracks = tracks.value ?? []
    if (allTracks.length === 0) {
      return
    }
    const nextId = getNextTrackId(allTracks)
    if (nextId) {
      const isUpNext = upNextQueue.value[0] === nextId
      selectTrack(nextId, { contextTracks: allTracks, consumeUpNext: isUpNext })
      setPlaying(true)
    }
  }

  function handlePrev(): void {
    const allTracks = tracks.value ?? []
    if (allTracks.length === 0) {
      return
    }
    const prevId = getPreviousTrackId(allTracks)
    if (prevId) {
      selectTrack(prevId, { contextTracks: allTracks, history: 'skip' })
      setPlaying(true)
    }
  }

  function adjustVolume(delta: number): void {
    const next = Math.min(1, Math.max(0, volume.value + delta))
    setVolume(next)
  }

  // Space – play/pause
  onKeyStroke(' ', (event) => {
    if (isEditableTarget(event.target)) {
      return
    }
    event.preventDefault()
    togglePlayPause()
  })

  // Ctrl+← / Ctrl+→ – previous / next track
  onKeyStroke(['ArrowLeft', 'ArrowRight'], (event) => {
    if (isEditableTarget(event.target)) {
      return
    }
    if (!event.ctrlKey && !event.metaKey) {
      return
    }
    event.preventDefault()
    if (event.key === 'ArrowLeft') {
      handlePrev()
    }
    else {
      handleNext()
    }
  })

  // ↑ / ↓ – volume
  onKeyStroke(['ArrowUp', 'ArrowDown'], (event) => {
    if (isEditableTarget(event.target)) {
      return
    }
    event.preventDefault()
    adjustVolume(event.key === 'ArrowUp' ? 0.05 : -0.05)
  })

  // M – mute toggle
  onKeyStroke('m', (event) => {
    if (isEditableTarget(event.target)) {
      return
    }
    event.preventDefault()
    toggleMute()
  })
}
