/**
 * Scrobble-style rule for when a listening session counts as a "play":
 * the listener must actually hear (not seek past)
 *   min(240s, max(30s, 50% of the duration), 80% of the duration)
 * of the track; unknown durations need 30s.
 *
 * The server (`api/src/playRules.ts`) is the source of truth; the client uses
 * this copy only to decide when to send an early checkpoint report.
 */
export const PLAY_MIN_SECONDS = 30
export const PLAY_MAX_SECONDS = 240

export function playThresholdSeconds(durationSeconds: number | null | undefined): number {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return PLAY_MIN_SECONDS
  }
  return Math.min(PLAY_MAX_SECONDS, Math.max(PLAY_MIN_SECONDS, durationSeconds * 0.5), durationSeconds * 0.8)
}
