import { playThresholdSeconds } from './playRules'

export type PlayReportStatus = 'playing' | 'ended' | 'skipped' | 'stopped'

export interface PlayReport {
  trackId: string
  sessionId: string
  startedAt: string
  listenedSeconds: number
  durationSeconds: number | null
  status: PlayReportStatus
  /** The page is going away; the request must survive unload. */
  keepalive: boolean
}

export interface PlayRecordedEvent {
  trackId: string
  /** Newly listened whole seconds acknowledged by the server. */
  listenedDelta: number
  /** True the first time the server reports this session as a counted play. */
  newlyCounted: boolean
  startedAt: string
}

export interface PlayTrackerOptions {
  send: (report: PlayReport) => Promise<{ counted: boolean } | null>
  onRecorded?: (event: PlayRecordedEvent) => void
  now?: () => number
  createId?: () => string
}

interface Session {
  id: string
  trackId: string
  startedAt: number
  listened: number
  duration: number | null
  checkpointSent: boolean
  lastReportedListened: number
  acked: { listened: number, counted: boolean }
}

/**
 * Largest gap between two `timeupdate` positions that is still treated as
 * continuous playback. Browsers fire `timeupdate` every ~250ms (up to ~1s when
 * throttled in the background); anything larger is a seek.
 */
const MAX_CONTINUOUS_STEP_SECONDS = 4
/** Sessions shorter than this are not worth reporting (e.g. a track that was only loaded). */
const MIN_REPORT_SECONDS = 1

/**
 * Measures how long each track is actually heard and reports it.
 *
 * Only forward progress between consecutive `timeupdate` positions counts, so
 * paused time and seeked-over ranges are excluded. A session covers one pass
 * through a track: it ends when the track ends (a repeat starts a new session),
 * when another track is selected, or when the page is closed. Each session is
 * reported at most a handful of times: once when the play threshold is crossed,
 * when the page is hidden, and when the session ends.
 */
export function createPlayTracker(options: PlayTrackerOptions) {
  const now = options.now ?? (() => Date.now())
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID())

  let currentTrackId: string | null = null
  let session: Session | null = null
  let lastPosition: number | null = null

  function report(target: Session, status: PlayReportStatus, keepalive: boolean): void {
    target.lastReportedListened = target.listened
    const payload: PlayReport = {
      trackId: target.trackId,
      sessionId: target.id,
      startedAt: new Date(target.startedAt).toISOString(),
      listenedSeconds: Math.round(target.listened * 1000) / 1000,
      durationSeconds: target.duration,
      status,
      keepalive,
    }
    options.send(payload).then((result) => {
      if (!result) {
        return
      }
      const listenedWhole = Math.floor(payload.listenedSeconds)
      const listenedDelta = Math.max(0, listenedWhole - target.acked.listened)
      const newlyCounted = result.counted && !target.acked.counted
      target.acked = {
        listened: Math.max(target.acked.listened, listenedWhole),
        counted: target.acked.counted || result.counted,
      }
      if (listenedDelta > 0 || newlyCounted) {
        options.onRecorded?.({ trackId: target.trackId, listenedDelta, newlyCounted, startedAt: payload.startedAt })
      }
    }).catch(() => {
      // Statistics are best effort; never disturb playback.
    })
  }

  function finish(status: Exclude<PlayReportStatus, 'playing'>, keepalive = false): void {
    const target = session
    session = null
    if (!target) {
      return
    }
    if (target.listened >= MIN_REPORT_SECONDS || target.checkpointSent) {
      report(target, status, keepalive)
    }
  }

  return {
    /** The selected track changed (or was cleared). */
    setTrack(trackId: string | null): void {
      if (trackId === currentTrackId) {
        return
      }
      finish('skipped')
      currentTrackId = trackId
      lastPosition = null
    },

    /** Feed every `timeupdate`. */
    timeUpdate(position: number, durationSeconds: number | null): void {
      if (!currentTrackId || !Number.isFinite(position)) {
        return
      }
      const previous = lastPosition
      lastPosition = position
      if (previous === null) {
        return
      }
      const step = position - previous
      if (step <= 0 || step > MAX_CONTINUOUS_STEP_SECONDS) {
        return
      }

      if (!session) {
        session = {
          id: createId(),
          trackId: currentTrackId,
          startedAt: now() - step * 1000,
          listened: 0,
          duration: null,
          checkpointSent: false,
          lastReportedListened: 0,
          acked: { listened: 0, counted: false },
        }
      }
      if (durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0) {
        session.duration = durationSeconds
      }
      session.listened += step

      if (!session.checkpointSent && session.listened >= playThresholdSeconds(session.duration)) {
        session.checkpointSent = true
        report(session, 'playing', false)
      }
    },

    /** A seek started; the next position must not be counted as listened. */
    seeking(): void {
      lastPosition = null
    },

    /** The track played to its end. A repeat of the same track starts a new session. */
    ended(): void {
      finish('ended')
      lastPosition = null
    },

    /** The page is being hidden; save progress without ending the session. */
    flush(): void {
      if (session && session.listened - session.lastReportedListened >= MIN_REPORT_SECONDS) {
        report(session, 'playing', true)
      }
    },

    /** The page is being unloaded. */
    stop(): void {
      finish('stopped', true)
      lastPosition = null
    },

    /** Test / debug helper. */
    getSession(): Readonly<Pick<Session, 'id' | 'trackId' | 'listened'>> | null {
      return session ? { id: session.id, trackId: session.trackId, listened: session.listened } : null
    },
  }
}

export type PlayTracker = ReturnType<typeof createPlayTracker>
