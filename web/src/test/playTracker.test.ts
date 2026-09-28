import type { PlayRecordedEvent, PlayReport } from '../utils/playTracker'
import { describe, expect, it } from 'vitest'
import { playThresholdSeconds } from '../utils/playRules'
import { createPlayTracker } from '../utils/playTracker'

function setup(counted: (report: PlayReport) => boolean = report => report.listenedSeconds >= playThresholdSeconds(report.durationSeconds)) {
  const reports: PlayReport[] = []
  const recorded: PlayRecordedEvent[] = []
  let clock = 1_700_000_000_000
  let nextId = 0
  const tracker = createPlayTracker({
    send: async (report) => {
      reports.push(report)
      return { counted: counted(report) }
    },
    onRecorded: event => recorded.push(event),
    now: () => clock,
    createId: () => `session-${++nextId}`,
  })

  /** Simulate continuous playback from `from` to `to` with 250ms timeupdates. */
  function play(from: number, to: number, duration: number | null = 200): void {
    for (let time = from; time <= to + 1e-9; time += 0.25) {
      clock += 250
      tracker.timeUpdate(time, duration)
    }
  }

  return { tracker, reports, recorded, play, flush: () => new Promise(resolve => setTimeout(resolve, 0)) }
}

describe('play rule', () => {
  it('matches the server rule', () => {
    expect(playThresholdSeconds(null)).toBe(30)
    expect(playThresholdSeconds(200)).toBe(100)
    expect(playThresholdSeconds(600)).toBe(240)
    expect(playThresholdSeconds(50)).toBe(30)
    expect(playThresholdSeconds(20)).toBe(16)
  })
})

describe('createplaytracker', () => {
  it('sends a checkpoint once the threshold is crossed and a final report when the track ends', async () => {
    const { tracker, reports, recorded, play, flush } = setup()
    tracker.setTrack('a')
    play(0, 99)
    expect(reports).toHaveLength(0)
    play(99.25, 120)
    expect(reports.map(report => report.status)).toEqual(['playing'])
    expect(reports[0].listenedSeconds).toBeGreaterThanOrEqual(100)
    play(120.25, 200)
    tracker.ended()
    await flush()

    expect(reports.map(report => report.status)).toEqual(['playing', 'ended'])
    expect(new Set(reports.map(report => report.sessionId)).size).toBe(1)
    expect(reports[1].listenedSeconds).toBeCloseTo(200, 0)
    expect(recorded.filter(event => event.newlyCounted)).toHaveLength(1)
    expect(recorded.reduce((sum, event) => sum + event.listenedDelta, 0)).toBe(200)
  })

  it('excludes paused time and seeked-over ranges', () => {
    const { tracker, reports, play } = setup()
    tracker.setTrack('a')
    play(0, 10)
    // Paused: no timeupdates, then resume from the same position.
    play(10.25, 20)
    // Seek forward 150s without a `seeking` event still does not count the jump.
    play(170, 175)
    tracker.seeking()
    play(40, 45)
    tracker.setTrack('b')

    expect(reports).toHaveLength(1)
    expect(reports[0].status).toBe('skipped')
    expect(reports[0].listenedSeconds).toBeCloseTo(30, 0)
  })

  it('starts a new session for each pass of a repeated track', () => {
    const { tracker, reports, play } = setup()
    tracker.setTrack('a')
    play(0, 60, 60)
    tracker.ended()
    play(0, 60, 60)
    tracker.ended()

    const finals = reports.filter(report => report.status === 'ended')
    expect(finals).toHaveLength(2)
    expect(finals[0].sessionId).not.toBe(finals[1].sessionId)
    expect(finals.every(report => Math.round(report.listenedSeconds) === 60)).toBe(true)
  })

  it('does not report tracks that were only loaded, and marks unload reports as keepalive', () => {
    const { tracker, reports, play } = setup()
    tracker.setTrack('a')
    tracker.timeUpdate(0, 200)
    tracker.setTrack('b')
    expect(reports).toHaveLength(0)

    play(0, 5)
    tracker.flush()
    tracker.stop()
    expect(reports.map(report => [report.trackId, report.status, report.keepalive])).toEqual([
      ['b', 'playing', true],
      ['b', 'stopped', true],
    ])
  })
})
