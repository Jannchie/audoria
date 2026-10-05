import { watch } from 'vue'
import { usePlayerState } from './usePlayerState'

// The audio element reports its time only a few times a second; extrapolating past the last
// report stops after this long, so a stalled stream doesn't run the highlight ahead of the sound.
const MAX_EXTRAPOLATION_SECONDS = 0.5
// Reports slightly behind the extrapolated time don't pull the highlight back; real seeks do.
const BACKWARD_TOLERANCE_SECONDS = 0.3

/**
 * Smooths a playback time that is reported in steps: between reports it advances with the
 * wall clock while playing, and it never steps backwards by less than a seek would.
 */
export function createPlaybackClock(now: () => number = () => performance.now()) {
  let reportedTime = 0
  let reportedAt = now()
  let playing = false
  let lastRead = 0

  return {
    report(time: number, isPlaying: boolean): void {
      reportedTime = time
      reportedAt = now()
      playing = isPlaying
    },
    /** Seconds. */
    read(): number {
      const elapsed = playing ? Math.min((now() - reportedAt) / 1000, MAX_EXTRAPOLATION_SECONDS) : 0
      const time = reportedTime + Math.max(0, elapsed)
      if (time < lastRead && lastRead - time < BACKWARD_TOLERANCE_SECONDS) {
        return lastRead
      }
      lastRead = time
      return time
    },
  }
}

/** The current playback time, smoothed for per-frame animation; seconds, seek error compensated. */
export function usePlaybackClock(): () => number {
  const { currentTime, isPlaying, lastSeekDelta } = usePlayerState()
  const clock = createPlaybackClock()
  watch([currentTime, isPlaying], ([time, playing]) => clock.report(time, playing), { immediate: true })
  return () => clock.read() - lastSeekDelta.value
}
