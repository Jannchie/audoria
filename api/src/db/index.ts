import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { config } from '../config.js'
import * as schema from './schema.js'

export type {
  MusicImportCandidate,
  MusicImportJob,
  MusicImportJobStatus,
  Playlist,
  PlaylistSummary,
  Track,
  Track as TrackLike,
} from './schema.js'

let db: any
let driver: 'sqlite' | 'd1' = 'sqlite'

export function getDriver(): 'sqlite' | 'd1' {
  return driver
}

export function setDb(drizzleInstance: any, dbDriver: 'sqlite' | 'd1'): void {
  db = drizzleInstance
  driver = dbDriver
}

export { db as __db }

// Re-export schema tables for direct use
export { tracks } from './schema.js'

function normalizePlaylistName(name: string): string {
  return name.trim()
}

function reindexPlaylistTracksWithinTransaction(playlistId: string): void {
  const items = db
    .select({
      trackId: schema.playlistTracks.trackId,
    })
    .from(schema.playlistTracks)
    .where(eq(schema.playlistTracks.playlistId, playlistId))
    .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt))
    .all() as Array<{ trackId: string }>

  for (const [index, item] of items.entries()) {
    db.update(schema.playlistTracks)
      .set({ position: index })
      .where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, item.trackId)))
      .run()
  }
}

// ── Track queries ──

export async function listTracks(): Promise<schema.Track[]> {
  return db.select().from(schema.tracks).orderBy(desc(schema.tracks.createdAt)).all() as Promise<schema.Track[]>
}

export async function getTrackById(id: string): Promise<schema.Track | undefined> {
  return db.select().from(schema.tracks).where(eq(schema.tracks.id, id)).get() as Promise<schema.Track | undefined>
}

export async function updateTrackEditableMetadata(id: string, metadata: {
  title: string | null
  artists: string | null
  album: string | null
  source: string | null
  lyrics: string | null
}): Promise<void> {
  db.update(schema.tracks)
    .set({
      title: metadata.title,
      artists: metadata.artists,
      album: metadata.album,
      source: metadata.source,
      lyrics: metadata.lyrics,
    })
    .where(eq(schema.tracks.id, id))
    .run()
}

export async function updateTrackCover(id: string, cover: {
  backend: string | null
  key: string | null
  contentType: string | null
  thumbBackend: string | null
  thumbKey: string | null
  thumbContentType: string | null
  thumbhash: string | null
}): Promise<void> {
  db.update(schema.tracks)
    .set({
      coverStorageBackend: cover.backend,
      coverStorageKey: cover.key,
      coverContentType: cover.contentType,
      coverThumbStorageBackend: cover.thumbBackend,
      coverThumbStorageKey: cover.thumbKey,
      coverThumbContentType: cover.thumbContentType,
      coverThumbhash: cover.thumbhash,
    })
    .where(eq(schema.tracks.id, id))
    .run()
}

export async function updateTrackImportedMetadata(id: string, metadata: {
  coverStorageBackend: string | null
  coverStorageKey: string | null
  coverContentType: string | null
  coverThumbStorageBackend: string | null
  coverThumbStorageKey: string | null
  coverThumbContentType: string | null
  coverThumbhash: string | null
  lyrics: string | null
  title: string | null
  artists: string | null
  album: string | null
  source: string | null
  sourceIdentifier: string | null
  durationText: string | null
  durationSeconds: number | null
}): Promise<void> {
  db.update(schema.tracks)
    .set({
      coverStorageBackend: metadata.coverStorageBackend,
      coverStorageKey: metadata.coverStorageKey,
      coverContentType: metadata.coverContentType,
      coverThumbStorageBackend: metadata.coverThumbStorageBackend,
      coverThumbStorageKey: metadata.coverThumbStorageKey,
      coverThumbContentType: metadata.coverThumbContentType,
      coverThumbhash: metadata.coverThumbhash,
      lyrics: metadata.lyrics,
      title: metadata.title,
      artists: metadata.artists,
      album: metadata.album,
      source: metadata.source,
      sourceIdentifier: metadata.sourceIdentifier,
      durationText: metadata.durationText,
      durationSeconds: metadata.durationSeconds,
    })
    .where(eq(schema.tracks.id, id))
    .run()
}

export async function deleteTrackRecord(id: string): Promise<void> {
  db.delete(schema.tracks).where(eq(schema.tracks.id, id)).run()
}

// ── Playlist queries ──

export async function listPlaylists(): Promise<schema.PlaylistSummary[]> {
  const items = db.select().from(schema.playlists).orderBy(desc(schema.playlists.updatedAt), desc(schema.playlists.createdAt)).all() as schema.Playlist[]

  return items.map((playlist: schema.Playlist) => {
    const aggregates = db
      .select({
        trackCount: sql<number>`count(${schema.playlistTracks.trackId})`,
        totalDurationSeconds: sql<number>`coalesce(sum(${schema.tracks.durationSeconds}), 0)`,
      })
      .from(schema.playlistTracks)
      .leftJoin(schema.tracks, eq(schema.playlistTracks.trackId, schema.tracks.id))
      .where(eq(schema.playlistTracks.playlistId, playlist.id))
      .get() as { trackCount: number, totalDurationSeconds: number } | undefined

    const previewCovers = db
      .select({
        trackId: schema.playlistTracks.trackId,
        coverThumbhash: schema.tracks.coverThumbhash,
      })
      .from(schema.playlistTracks)
      .innerJoin(schema.tracks, eq(schema.playlistTracks.trackId, schema.tracks.id))
      .where(and(
        eq(schema.playlistTracks.playlistId, playlist.id),
        sql`(${schema.tracks.coverThumbStorageKey} IS NOT NULL OR ${schema.tracks.coverStorageKey} IS NOT NULL)`,
      ))
      .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt))
      .limit(4)
      .all() as Array<{ trackId: string, coverThumbhash: string | null }>

    return {
      ...playlist,
      trackCount: Number(aggregates?.trackCount ?? 0),
      totalDurationSeconds: Number(aggregates?.totalDurationSeconds ?? 0),
      previewTrackIds: previewCovers.map(row => row.trackId),
      previewCoverThumbhashes: previewCovers.map(row => row.coverThumbhash),
    }
  })
}

export async function createPlaylist(input: {
  name: string
  description: string | null
}): Promise<schema.Playlist> {
  const now = Date.now()
  const record: schema.Playlist = {
    id: randomUUID(),
    name: normalizePlaylistName(input.name),
    description: input.description,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(schema.playlists).values(record).run()
  return record
}

export async function getPlaylistById(id: string): Promise<schema.Playlist | undefined> {
  return db.select().from(schema.playlists).where(eq(schema.playlists.id, id)).get() as Promise<schema.Playlist | undefined>
}

export async function updatePlaylist(id: string, input: {
  name: string
  description: string | null
}): Promise<void> {
  db.update(schema.playlists)
    .set({
      name: normalizePlaylistName(input.name),
      description: input.description,
      updatedAt: Date.now(),
    })
    .where(eq(schema.playlists.id, id))
    .run()
}

export async function deletePlaylist(id: string): Promise<void> {
  db.transaction(() => {
    db.delete(schema.playlistTracks).where(eq(schema.playlistTracks.playlistId, id)).run()
    db.delete(schema.playlists).where(eq(schema.playlists.id, id)).run()
  })
}

export async function getPlaylistTracks(playlistId: string): Promise<schema.Track[]> {
  const rows = db
    .select({
      track: schema.tracks,
    })
    .from(schema.playlistTracks)
    .innerJoin(schema.tracks, eq(schema.playlistTracks.trackId, schema.tracks.id))
    .where(eq(schema.playlistTracks.playlistId, playlistId))
    .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt))
    .all() as Array<{ track: schema.Track }>

  return rows.map(row => row.track)
}

export async function getPlaylistTrackIds(playlistId: string): Promise<string[]> {
  const rows = db
    .select({
      trackId: schema.playlistTracks.trackId,
    })
    .from(schema.playlistTracks)
    .where(eq(schema.playlistTracks.playlistId, playlistId))
    .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt))
    .all() as Array<{ trackId: string }>

  return rows.map(row => row.trackId)
}

export async function addTrackToPlaylist(playlistId: string, trackId: string): Promise<void> {
  const existing = db.select().from(schema.playlistTracks).where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, trackId))).get()

  if (existing) {
    throw new Error('Track already exists in playlist')
  }

  const maxPositionRow = db
    .select({
      position: sql<number>`max(${schema.playlistTracks.position})`,
    })
    .from(schema.playlistTracks)
    .where(eq(schema.playlistTracks.playlistId, playlistId))
    .get() as { position: number } | undefined

  db.insert(schema.playlistTracks).values({
    playlistId,
    trackId,
    position: Number(maxPositionRow?.position ?? -1) + 1,
    createdAt: Date.now(),
  }).run()

  db.update(schema.playlists)
    .set({ updatedAt: Date.now() })
    .where(eq(schema.playlists.id, playlistId))
    .run()
}

export async function removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<boolean> {
  return db.transaction(() => {
    const deleted = db.delete(schema.playlistTracks)
      .where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, trackId)))
      .run()

    if (deleted.changes === 0) {
      return false
    }

    reindexPlaylistTracksWithinTransaction(playlistId)
    db.update(schema.playlists)
      .set({ updatedAt: Date.now() })
      .where(eq(schema.playlists.id, playlistId))
      .run()
    return true
  }) as Promise<boolean>
}

export async function reorderPlaylistTracks(playlistId: string, orderedTrackIds: string[]): Promise<void> {
  db.transaction(() => {
    for (const [index, trackId] of orderedTrackIds.entries()) {
      db.update(schema.playlistTracks)
        .set({ position: index })
        .where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, trackId)))
        .run()
    }

    db.update(schema.playlists)
      .set({ updatedAt: Date.now() })
      .where(eq(schema.playlists.id, playlistId))
      .run()
  })
}

export async function getPlaylistIdsForTracks(trackIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (trackIds.length === 0) {
    return map
  }
  const rows = db
    .select({
      trackId: schema.playlistTracks.trackId,
      playlistId: schema.playlistTracks.playlistId,
    })
    .from(schema.playlistTracks)
    .where(inArray(schema.playlistTracks.trackId, trackIds))
    .all() as Array<{ trackId: string, playlistId: string }>

  for (const row of rows) {
    const list = map.get(row.trackId)
    if (list) {
      list.push(row.playlistId)
    }
    else {
      map.set(row.trackId, [row.playlistId])
    }
  }
  return map
}

export async function listAllTrackPlaylistPairs(): Promise<Map<string, string[]>> {
  const rows = db
    .select({
      trackId: schema.playlistTracks.trackId,
      playlistId: schema.playlistTracks.playlistId,
    })
    .from(schema.playlistTracks)
    .all() as Array<{ trackId: string, playlistId: string }>

  const map = new Map<string, string[]>()
  for (const row of rows) {
    const list = map.get(row.trackId)
    if (list) {
      list.push(row.playlistId)
    }
    else {
      map.set(row.trackId, [row.playlistId])
    }
  }
  return map
}

export async function removeTrackFromAllPlaylists(trackId: string): Promise<void> {
  const playlistIds = db
    .select({
      playlistId: schema.playlistTracks.playlistId,
    })
    .from(schema.playlistTracks)
    .where(eq(schema.playlistTracks.trackId, trackId))
    .all() as Array<{ playlistId: string }>

  if (playlistIds.length === 0) {
    return
  }

  db.transaction(() => {
    db.delete(schema.playlistTracks).where(eq(schema.playlistTracks.trackId, trackId)).run()
    const uniquePlaylistIds = [...new Set(playlistIds.map(p => p.playlistId))]
    for (const playlistId of uniquePlaylistIds) {
      reindexPlaylistTracksWithinTransaction(playlistId)
      db.update(schema.playlists)
        .set({ updatedAt: Date.now() })
        .where(eq(schema.playlists.id, playlistId))
        .run()
    }
  })
}

// ── Music import candidate queries ──

export async function insertMusicImportCandidates(candidates: Array<Omit<schema.MusicImportCandidate, 'id' | 'createdAt'>>): Promise<schema.MusicImportCandidate[]> {
  const createdAt = Date.now()
  const records = candidates.map(candidate => ({
    id: randomUUID(),
    createdAt,
    ...candidate,
  }))
  if (records.length > 0) {
    db.insert(schema.musicImportCandidates).values(records).run()
  }
  return records
}

export async function pruneExpiredMusicImportCandidates(now = Date.now()): Promise<void> {
  const cutoff = now - config.importCandidateTtlMs
  db.delete(schema.musicImportCandidates).where(lt(schema.musicImportCandidates.createdAt, cutoff)).run()
}

export async function getMusicImportCandidateById(id: string): Promise<schema.MusicImportCandidate | undefined> {
  return db.select().from(schema.musicImportCandidates).where(eq(schema.musicImportCandidates.id, id)).get() as Promise<schema.MusicImportCandidate | undefined>
}

// ── Music import job queries ──

export async function createMusicImportJobFromCandidate(candidate: schema.MusicImportCandidate, overrides?: {
  source?: string
  songName?: string
  singers?: string
  songInfoJson?: string
}): Promise<schema.MusicImportJob> {
  const now = Date.now()
  const record: schema.MusicImportJob = {
    id: randomUUID(),
    source: overrides?.source ?? candidate.source,
    songName: overrides?.songName ?? candidate.songName,
    singers: overrides?.singers ?? candidate.singers,
    status: 'queued',
    songInfoJson: overrides?.songInfoJson ?? candidate.songInfoJson,
    trackId: null,
    errorMessage: null,
    progressBytes: 0,
    totalBytes: null,
    progressPercent: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  }
  db.insert(schema.musicImportJobs).values(record).run()
  return record
}

export async function getMusicImportJobById(id: string): Promise<schema.MusicImportJob | undefined> {
  return db.select().from(schema.musicImportJobs).where(eq(schema.musicImportJobs.id, id)).get() as Promise<schema.MusicImportJob | undefined>
}

export async function requeueRunningMusicImportJobs(): Promise<void> {
  const now = Date.now()
  db.update(schema.musicImportJobs)
    .set({
      status: 'queued',
      updatedAt: now,
      startedAt: null,
      errorMessage: null,
      progressBytes: 0,
      totalBytes: null,
      progressPercent: null,
    })
    .where(eq(schema.musicImportJobs.status, 'running'))
    .run()
}

export async function claimNextQueuedMusicImportJob(): Promise<schema.MusicImportJob | null> {
  const queuedJob = db
    .select()
    .from(schema.musicImportJobs)
    .where(eq(schema.musicImportJobs.status, 'queued'))
    .orderBy(schema.musicImportJobs.createdAt)
    .get() as schema.MusicImportJob | undefined

  if (!queuedJob) {
    return null
  }

  const now = Date.now()
  const updateResult = db.update(schema.musicImportJobs)
    .set({
      status: 'running',
      updatedAt: now,
      startedAt: now,
      errorMessage: null,
      progressBytes: 0,
      totalBytes: null,
      progressPercent: null,
    })
    .where(and(eq(schema.musicImportJobs.id, queuedJob.id), eq(schema.musicImportJobs.status, 'queued')))
    .run() as { changes: number }

  if (updateResult.changes === 0) {
    return null
  }

  return (await getMusicImportJobById(queuedJob.id)) ?? null
}

export async function updateMusicImportJobProgress(id: string, progress: {
  progressBytes: number
  totalBytes: number | null
}): Promise<void> {
  const normalizedProgressBytes = Math.max(0, Math.floor(progress.progressBytes))
  const normalizedTotalBytes = progress.totalBytes === null ? null : Math.max(0, Math.floor(progress.totalBytes))
  const progressPercent = normalizedTotalBytes && normalizedTotalBytes > 0
    ? Math.min(100, Math.floor((normalizedProgressBytes / normalizedTotalBytes) * 100))
    : null

  db.update(schema.musicImportJobs)
    .set({
      progressBytes: normalizedProgressBytes,
      totalBytes: normalizedTotalBytes,
      progressPercent,
      updatedAt: Date.now(),
    })
    .where(eq(schema.musicImportJobs.id, id))
    .run()
}

export async function markMusicImportJobSucceeded(id: string, trackId: string, size: number): Promise<void> {
  const now = Date.now()
  db.update(schema.musicImportJobs)
    .set({
      status: 'succeeded',
      trackId,
      progressBytes: size,
      totalBytes: size,
      progressPercent: 100,
      updatedAt: now,
      finishedAt: now,
      errorMessage: null,
    })
    .where(eq(schema.musicImportJobs.id, id))
    .run()
}

export async function markMusicImportJobFailed(id: string, errorMessage: string): Promise<void> {
  const now = Date.now()
  db.update(schema.musicImportJobs)
    .set({
      status: 'failed',
      errorMessage,
      updatedAt: now,
      finishedAt: now,
    })
    .where(eq(schema.musicImportJobs.id, id))
    .run()
}
