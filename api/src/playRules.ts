/**
 * Scrobble-style rule for when a listening session counts as a "play".
 *
 * A session counts once the listener has actually heard (not seeked past)
 *   min(240s, max(30s, 50% of the duration), 80% of the duration)
 * of the track. Unknown durations fall back to 30s. The 80% cap only matters
 * for tracks shorter than ~37s, where "30 seconds" would be unreachable.
 *
 * Keep in sync with `web/src/utils/playRules.ts`.
 */
export const PLAY_MIN_SECONDS = 30
export const PLAY_MAX_SECONDS = 240

export function playThresholdSeconds(durationSeconds: number | null | undefined): number {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return PLAY_MIN_SECONDS
  }
  return Math.min(PLAY_MAX_SECONDS, Math.max(PLAY_MIN_SECONDS, durationSeconds * 0.5), durationSeconds * 0.8)
}

export function isCountedPlay(listenedSeconds: number, durationSeconds: number | null | undefined): boolean {
  return listenedSeconds >= playThresholdSeconds(durationSeconds)
}
