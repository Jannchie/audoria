import type { PlayEvent, Track } from './schema.js'
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { isCountedPlay } from '../playRules.js'
import { __db as db } from './index.js'
import * as schema from './schema.js'

// Same thin wrappers as in ./index.ts: better-sqlite3 queries resolve
// synchronously, D1 queries return promises.
async function queryAll<T>(query: { all: () => T | Promise<T> }): Promise<T> {
  return await query.all()
}

async function queryGet<T>(query: { get: () => T | Promise<T> }): Promise<T> {
  return await query.get()
}

async function queryRun<T>(query: { run: () => T | Promise<T> }): Promise<T> {
  return await query.run()
}

// better-sqlite3 reports `changes` at the top level, D1 nests it under `meta`.
function getChangedRows(result: unknown): number {
  const value = result as { changes?: number, meta?: { changes?: number } } | null | undefined
  return Number(value?.changes ?? value?.meta?.changes ?? 0)
}

export type PlayEventStatus = 'playing' | 'ended' | 'skipped' | 'stopped'

export interface RecordPlayEventInput {
  sessionId: string
  track: Pick<Track, 'id' | 'durationSeconds'>
  startedAt: number
  listenedSeconds: number
  /** Duration reported by the client; only used when the track has none stored. */
  durationSeconds: number | null
  status: PlayEventStatus
  now?: number
}

export interface RecordPlayEventResult {
  counted: boolean
  finalized: boolean
}

export class PlaySessionConflictError extends Error {}

const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000
const LISTEN_SLACK_SECONDS = 5

/**
 * Upserts one listening session and applies the delta to the track aggregates.
 *
 * A session may be reported several times (a checkpoint once the play threshold
 * is crossed, then a final report). Only the growth of listened time since the
 * previous report is added to the track, the play is counted at most once, and
 * a finalized session ignores further reports. Concurrent reports for the same
 * session are resolved with an optimistic compare-and-set on the event row, so
 * this works without transactions (D1 over HTTP has none).
 */
export async function recordPlayEvent(input: RecordPlayEventInput): Promise<RecordPlayEventResult> {
  const now = input.now ?? Date.now()
  const durationSeconds = input.track.durationSeconds
    ?? (input.durationSeconds && input.durationSeconds > 0 ? Math.round(input.durationSeconds) : null)
  const startedAt = Math.min(now, Math.max(now - MAX_SESSION_AGE_MS, Math.floor(input.startedAt)))

  await queryRun(db.insert(schema.playEvents).values({
    id: input.sessionId,
    trackId: input.track.id,
    startedAt,
    updatedAt: now,
    endedAt: null,
    listenedSeconds: 0,
    durationSeconds,
    counted: 0,
    completed: 0,
    skipped: 0,
    endReason: null,
  }).onConflictDoNothing())

  const existing = await queryGet<PlayEvent | undefined>(
    db.select().from(schema.playEvents).where(eq(schema.playEvents.id, input.sessionId)),
  )
  if (!existing || existing.trackId !== input.track.id) {
    throw new PlaySessionConflictError('Play session belongs to another track')
  }
  if (existing.endedAt !== null) {
    return { counted: existing.counted === 1, finalized: true }
  }

  // Listened time can never exceed the wall-clock time since the session
  // began, nor (much) more than one pass through the track.
  const elapsedSeconds = Math.max(0, (now - existing.startedAt) / 1000) + LISTEN_SLACK_SECONDS
  const maxByDuration = durationSeconds ? durationSeconds + LISTEN_SLACK_SECONDS : Number.POSITIVE_INFINITY
  const reported = Math.max(0, Math.min(input.listenedSeconds, elapsedSeconds, maxByDuration))
  const listened = Math.max(existing.listenedSeconds, reported)
  const listenedWhole = Math.floor(listened)
  const counted = existing.counted === 1 || isCountedPlay(listened, durationSeconds)
  const final = input.status !== 'playing'
  const skipped = final && input.status === 'skipped' && !counted

  const updated = await queryRun(db.update(schema.playEvents)
    .set({
      updatedAt: now,
      listenedSeconds: listenedWhole,
      counted: counted ? 1 : 0,
      completed: input.status === 'ended' ? 1 : 0,
      skipped: skipped ? 1 : 0,
      endedAt: final ? now : null,
      endReason: final ? input.status : null,
    })
    .where(and(
      eq(schema.playEvents.id, existing.id),
      eq(schema.playEvents.listenedSeconds, existing.listenedSeconds),
      eq(schema.playEvents.counted, existing.counted),
      isNull(schema.playEvents.endedAt),
    )))

  if (getChangedRows(updated) === 0) {
    // Another report for this session won the race and applied its own delta.
    return { counted, finalized: final }
  }

  const listenedDelta = Math.max(0, listenedWhole - existing.listenedSeconds)
  const playDelta = counted && existing.counted !== 1 ? 1 : 0
  const skipDelta = skipped ? 1 : 0

  if (listenedDelta > 0 || playDelta > 0 || skipDelta > 0) {
    await queryRun(db.update(schema.tracks)
      .set({
        playCount: sql`${schema.tracks.playCount} + ${playDelta}`,
        skipCount: sql`${schema.tracks.skipCount} + ${skipDelta}`,
        listenedSeconds: sql`${schema.tracks.listenedSeconds} + ${listenedDelta}`,
        ...(playDelta > 0
          ? { lastPlayedAt: sql`max(coalesce(${schema.tracks.lastPlayedAt}, 0), ${existing.startedAt})` }
          : {}),
      })
      .where(eq(schema.tracks.id, existing.trackId)))
  }

  return { counted, finalized: final }
}

export async function deletePlayEventsForTrack(trackId: string): Promise<void> {
  await queryRun(db.delete(schema.playEvents).where(eq(schema.playEvents.trackId, trackId)))
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface ListeningStats {
  totals: {
    playCount: number
    skipCount: number
    listenedSeconds: number
    playedTrackCount: number
    trackCount: number
  }
  period: {
    days: number
    playCount: number
    listenedSeconds: number
  }
  daily: Array<{ date: string, playCount: number, listenedSeconds: number }>
  topTracks: Array<{ track: Track, playCount: number, listenedSeconds: number }>
  recentPlays: Array<{ track: Track, playedAt: number, listenedSeconds: number, completed: boolean }>
}

/**
 * All-time totals come from the per-track aggregates (cheap); the daily
 * histogram and top tracks come from play events inside the last `days` days.
 * `tzOffsetMinutes` is the client's `Date#getTimezoneOffset()`, so days are
 * bucketed in the listener's local time.
 */
export async function getListeningStats(options: {
  days: number
  tzOffsetMinutes: number
  limit: number
  now?: number
}): Promise<ListeningStats> {
  const now = options.now ?? Date.now()
  const offsetMs = Math.trunc(options.tzOffsetMinutes) * 60_000
  const today = Math.floor((now - offsetMs) / DAY_MS)
  const firstDay = today - options.days + 1
  const windowStart = firstDay * DAY_MS + offsetMs
  // offsetMs is an integer computed here, so inlining it is safe and keeps the
  // select and group-by expressions textually identical.
  const dayExpr = sql<number>`cast((${schema.playEvents.startedAt} - (${sql.raw(String(offsetMs))})) / ${sql.raw(String(DAY_MS))} as integer)`

  const totalsRow = await queryGet<Record<string, number | null> | undefined>(db
    .select({
      playCount: sql<number>`coalesce(sum(${schema.tracks.playCount}), 0)`,
      skipCount: sql<number>`coalesce(sum(${schema.tracks.skipCount}), 0)`,
      listenedSeconds: sql<number>`coalesce(sum(${schema.tracks.listenedSeconds}), 0)`,
      playedTrackCount: sql<number>`coalesce(sum(case when ${schema.tracks.playCount} > 0 then 1 else 0 end), 0)`,
      trackCount: sql<number>`count(*)`,
    })
    .from(schema.tracks))

  const dailyRows = await queryAll<Array<{ day: number, playCount: number, listenedSeconds: number }>>(db
    .select({
      day: dayExpr,
      playCount: sql<number>`coalesce(sum(${schema.playEvents.counted}), 0)`,
      listenedSeconds: sql<number>`coalesce(sum(${schema.playEvents.listenedSeconds}), 0)`,
    })
    .from(schema.playEvents)
    .where(gte(schema.playEvents.startedAt, windowStart))
    .groupBy(dayExpr))

  const byDay = new Map(dailyRows.map(row => [Number(row.day), row]))
  const daily: ListeningStats['daily'] = []
  for (let day = firstDay; day <= today; day++) {
    const row = byDay.get(day)
    daily.push({
      date: new Date(day * DAY_MS).toISOString().slice(0, 10),
      playCount: Number(row?.playCount ?? 0),
      listenedSeconds: Number(row?.listenedSeconds ?? 0),
    })
  }

  const playsExpr = sql<number>`sum(${schema.playEvents.counted})`
  const listenedExpr = sql<number>`sum(${schema.playEvents.listenedSeconds})`
  const topRows = await queryAll<Array<{ trackId: string, playCount: number, listenedSeconds: number }>>(db
    .select({
      trackId: schema.playEvents.trackId,
      playCount: playsExpr,
      listenedSeconds: listenedExpr,
    })
    .from(schema.playEvents)
    .where(gte(schema.playEvents.startedAt, windowStart))
    .groupBy(schema.playEvents.trackId)
    .having(sql`${playsExpr} > 0`)
    .orderBy(desc(playsExpr), desc(listenedExpr))
    .limit(options.limit))

  const topTrackRecords = topRows.length > 0
    ? await queryAll<Track[]>(db.select().from(schema.tracks).where(inArray(schema.tracks.id, topRows.map(row => row.trackId))))
    : []
  const topTrackById = new Map(topTrackRecords.map(track => [track.id, track]))
  const topTracks: ListeningStats['topTracks'] = []
  for (const row of topRows) {
    const track = topTrackById.get(row.trackId)
    if (track) {
      topTracks.push({ track, playCount: Number(row.playCount), listenedSeconds: Number(row.listenedSeconds) })
    }
  }

  const recentRows = await queryAll<Array<{ track: Track, playedAt: number, listenedSeconds: number, completed: number }>>(db
    .select({
      track: schema.tracks,
      playedAt: schema.playEvents.startedAt,
      listenedSeconds: schema.playEvents.listenedSeconds,
      completed: schema.playEvents.completed,
    })
    .from(schema.playEvents)
    .innerJoin(schema.tracks, eq(schema.playEvents.trackId, schema.tracks.id))
    .where(eq(schema.playEvents.counted, 1))
    .orderBy(desc(schema.playEvents.startedAt))
    .limit(options.limit))

  return {
    totals: {
      playCount: Number(totalsRow?.playCount ?? 0),
      skipCount: Number(totalsRow?.skipCount ?? 0),
      listenedSeconds: Number(totalsRow?.listenedSeconds ?? 0),
      playedTrackCount: Number(totalsRow?.playedTrackCount ?? 0),
      trackCount: Number(totalsRow?.trackCount ?? 0),
    },
    period: {
      days: options.days,
      playCount: daily.reduce((sum, item) => sum + item.playCount, 0),
      listenedSeconds: daily.reduce((sum, item) => sum + item.listenedSeconds, 0),
    },
    daily,
    topTracks,
    recentPlays: recentRows.map(row => ({
      track: row.track,
      playedAt: Number(row.playedAt),
      listenedSeconds: Number(row.listenedSeconds),
      completed: Number(row.completed) === 1,
    })),
  }
}
