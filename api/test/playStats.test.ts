import type { Track } from '../src/db/schema.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
// The api package has no vitest dependency; it runs on the built-in runner.
// eslint-disable-next-line test/no-import-node-test
import { beforeEach, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { __db as db } from '../src/db/index.js'
import { deletePlayEventsForTrack, getListeningStats, PlaySessionConflictError, recordPlayEvent } from '../src/db/playStats.js'
import { playEvents, tracks } from '../src/db/schema.js'
import { initSqlite } from '../src/db/sqlite.js'
import { isCountedPlay, playThresholdSeconds } from '../src/playRules.js'

const DAY_MS = 24 * 60 * 60 * 1000
// 2024-01-10T12:00:00Z
const NOW = Date.UTC(2024, 0, 10, 12)

function insertTrack(id: string, durationSeconds: number | null): Track {
  const record: Track = {
    id,
    filename: `${id}.mp3`,
    storageBackend: 'fs',
    storageKey: id,
    coverStorageBackend: null,
    coverStorageKey: null,
    coverContentType: null,
    coverThumbStorageBackend: null,
    coverThumbStorageKey: null,
    coverThumbContentType: null,
    coverThumbhash: null,
    title: id,
    artists: null,
    album: null,
    source: null,
    sourceIdentifier: null,
    durationText: null,
    durationSeconds,
    size: 1,
    contentType: 'audio/mpeg',
    lyrics: null,
    lyricsDoc: null,
    sortOrder: null,
    playCount: 0,
    skipCount: 0,
    listenedSeconds: 0,
    lastPlayedAt: null,
    createdAt: NOW,
  }
  db.insert(tracks).values(record).run()
  return record
}

function getTrack(id: string): Track {
  return db.select().from(tracks).all().find((row: Track) => row.id === id)
}

describe('sqlite bootstrap', () => {
  it('adds the statistics columns to an existing tracks table', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'audoria-upgrade-')), 'old.sqlite')
    const legacy = new Database(file)
    legacy.exec(`CREATE TABLE tracks (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, storage_backend TEXT NOT NULL, storage_key TEXT NOT NULL,
      size INTEGER NOT NULL, content_type TEXT, created_at INTEGER NOT NULL
    ); INSERT INTO tracks VALUES ('old', 'old.mp3', 'fs', 'old', 1, NULL, 0);`)
    legacy.close()

    initSqlite(file)
    const row = getTrack('old')
    assert.equal(row.playCount, 0)
    assert.equal(row.skipCount, 0)
    assert.equal(row.listenedSeconds, 0)
    assert.equal(row.lastPlayedAt, null)
  })
})

describe('play rule', () => {
  it('uses 30s for unknown durations', () => {
    assert.equal(playThresholdSeconds(null), 30)
    assert.equal(playThresholdSeconds(0), 30)
  })

  it('needs half of a normal track, capped at 4 minutes', () => {
    assert.equal(playThresholdSeconds(200), 100)
    assert.equal(playThresholdSeconds(600), 240)
    assert.equal(playThresholdSeconds(50), 30)
  })

  it('stays reachable for very short tracks', () => {
    assert.equal(playThresholdSeconds(20), 16)
    assert.ok(isCountedPlay(16, 20))
    assert.ok(!isCountedPlay(15, 20))
  })
})

describe('recordplayevent', () => {
  let track: Track

  beforeEach(() => {
    initSqlite(':memory:')
    track = insertTrack('a', 200)
  })

  it('counts a play once across checkpoint and final report', async () => {
    const sessionId = randomUUID()
    const startedAt = NOW - 150_000
    const first = await recordPlayEvent({ sessionId, track, startedAt, listenedSeconds: 101, durationSeconds: 200, status: 'playing', now: NOW - 40_000 })
    assert.deepEqual(first, { counted: true, finalized: false })
    const second = await recordPlayEvent({ sessionId, track, startedAt, listenedSeconds: 140.7, durationSeconds: 200, status: 'skipped', now: NOW })
    assert.deepEqual(second, { counted: true, finalized: true })
    // Reports after finalization are ignored.
    await recordPlayEvent({ sessionId, track, startedAt, listenedSeconds: 190, durationSeconds: 200, status: 'ended', now: NOW })

    const row = getTrack('a')
    assert.equal(row.playCount, 1)
    assert.equal(row.skipCount, 0)
    assert.equal(row.listenedSeconds, 140)
    assert.equal(row.lastPlayedAt, startedAt)
  })

  it('records a skip when leaving before the threshold', async () => {
    const result = await recordPlayEvent({ sessionId: randomUUID(), track, startedAt: NOW - 20_000, listenedSeconds: 12, durationSeconds: 200, status: 'skipped', now: NOW })
    assert.deepEqual(result, { counted: false, finalized: true })
    const row = getTrack('a')
    assert.equal(row.playCount, 0)
    assert.equal(row.skipCount, 1)
    assert.equal(row.listenedSeconds, 12)
    assert.equal(row.lastPlayedAt, null)
  })

  it('caps listened time by wall-clock time and track duration', async () => {
    await recordPlayEvent({ sessionId: randomUUID(), track, startedAt: NOW - 10_000, listenedSeconds: 5000, durationSeconds: 200, status: 'stopped', now: NOW })
    assert.equal(getTrack('a').listenedSeconds, 15)
    await recordPlayEvent({ sessionId: randomUUID(), track, startedAt: NOW - 3_600_000, listenedSeconds: 5000, durationSeconds: 200, status: 'ended', now: NOW })
    assert.equal(getTrack('a').listenedSeconds, 15 + 205)
  })

  it('rejects reusing a session id for another track', async () => {
    const other = insertTrack('b', 100)
    const sessionId = randomUUID()
    await recordPlayEvent({ sessionId, track, startedAt: NOW - 5000, listenedSeconds: 1, durationSeconds: null, status: 'playing', now: NOW })
    await assert.rejects(
      recordPlayEvent({ sessionId, track: other, startedAt: NOW - 5000, listenedSeconds: 1, durationSeconds: null, status: 'playing', now: NOW }),
      PlaySessionConflictError,
    )
  })
})

describe('getlisteningstats', () => {
  beforeEach(() => {
    initSqlite(':memory:')
  })

  it('aggregates totals, local-day history, top and recent tracks', async () => {
    const a = insertTrack('a', 200)
    const b = insertTrack('b', 100)
    insertTrack('never', 100)

    // Two plays of `a` today, one play of `b` yesterday, one skip of `b` today.
    await recordPlayEvent({ sessionId: randomUUID(), track: a, startedAt: NOW - 3_000_000, listenedSeconds: 200, durationSeconds: 200, status: 'ended', now: NOW - 2_700_000 })
    await recordPlayEvent({ sessionId: randomUUID(), track: a, startedAt: NOW - 1_000_000, listenedSeconds: 120, durationSeconds: 200, status: 'skipped', now: NOW - 800_000 })
    await recordPlayEvent({ sessionId: randomUUID(), track: b, startedAt: NOW - DAY_MS, listenedSeconds: 100, durationSeconds: 100, status: 'ended', now: NOW - DAY_MS + 200_000 })
    await recordPlayEvent({ sessionId: randomUUID(), track: b, startedAt: NOW - 100_000, listenedSeconds: 10, durationSeconds: 100, status: 'skipped', now: NOW - 80_000 })
    // Outside the 7-day window.
    await recordPlayEvent({ sessionId: randomUUID(), track: b, startedAt: NOW - 10 * DAY_MS, listenedSeconds: 100, durationSeconds: 100, status: 'ended', now: NOW - 10 * DAY_MS + 200_000 })

    const stats = await getListeningStats({ days: 7, tzOffsetMinutes: 0, limit: 10, now: NOW })

    assert.deepEqual(stats.totals, { playCount: 4, skipCount: 1, listenedSeconds: 530, playedTrackCount: 2, trackCount: 3 })
    assert.deepEqual(stats.period, { days: 7, playCount: 3, listenedSeconds: 430 })
    assert.equal(stats.daily.length, 7)
    assert.deepEqual(stats.daily.at(-1), { date: '2024-01-10', playCount: 2, listenedSeconds: 330 })
    assert.deepEqual(stats.daily.at(-2), { date: '2024-01-09', playCount: 1, listenedSeconds: 100 })
    assert.equal(stats.daily[0].date, '2024-01-04')

    assert.deepEqual(stats.topTracks.map(item => [item.track.id, item.playCount, item.listenedSeconds]), [['a', 2, 320], ['b', 1, 110]])
    assert.deepEqual(stats.recentPlays.map(item => item.track.id), ['a', 'a', 'b', 'b'])
  })

  it('buckets days in the client time zone', async () => {
    const a = insertTrack('a', 200)
    // 2024-01-10T12:00Z minus 13h = 2024-01-09T23:00Z, which is already 2024-01-10 in JST (UTC+9).
    await recordPlayEvent({ sessionId: randomUUID(), track: a, startedAt: NOW - 13 * 3_600_000, listenedSeconds: 200, durationSeconds: 200, status: 'ended', now: NOW - 12 * 3_600_000 })

    const utc = await getListeningStats({ days: 2, tzOffsetMinutes: 0, limit: 5, now: NOW })
    assert.deepEqual(utc.daily.map(item => [item.date, item.playCount]), [['2024-01-09', 1], ['2024-01-10', 0]])

    const jst = await getListeningStats({ days: 2, tzOffsetMinutes: -540, limit: 5, now: NOW })
    assert.deepEqual(jst.daily.map(item => [item.date, item.playCount]), [['2024-01-09', 0], ['2024-01-10', 1]])
  })

  it('drops events of deleted tracks', async () => {
    const a = insertTrack('a', 200)
    await recordPlayEvent({ sessionId: randomUUID(), track: a, startedAt: NOW - 300_000, listenedSeconds: 200, durationSeconds: 200, status: 'ended', now: NOW })
    await deletePlayEventsForTrack('a')
    assert.equal(db.select().from(playEvents).all().length, 0)
  })
})
