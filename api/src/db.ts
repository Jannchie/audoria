import type { InferSelectModel } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { config } from './config.js'

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  storageBackend: text('storage_backend').notNull(),
  storageKey: text('storage_key').notNull(),
  coverStorageBackend: text('cover_storage_backend'),
  coverStorageKey: text('cover_storage_key'),
  coverContentType: text('cover_content_type'),
  coverThumbStorageBackend: text('cover_thumb_storage_backend'),
  coverThumbStorageKey: text('cover_thumb_storage_key'),
  coverThumbContentType: text('cover_thumb_content_type'),
  title: text('title'),
  artists: text('artists'),
  album: text('album'),
  source: text('source'),
  sourceIdentifier: text('source_identifier'),
  durationText: text('duration_text'),
  durationSeconds: integer('duration_seconds', { mode: 'number' }),
  size: integer('size', { mode: 'number' }).notNull(),
  contentType: text('content_type'),
  lyrics: text('lyrics'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
})

export const musicImportCandidates = sqliteTable('music_import_candidates', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  songName: text('song_name').notNull(),
  singers: text('singers').notNull(),
  album: text('album').notNull(),
  ext: text('ext').notNull(),
  fileSize: text('file_size').notNull(),
  duration: text('duration').notNull(),
  coverUrl: text('cover_url'),
  downloadable: integer('downloadable', { mode: 'number' }).notNull(),
  songInfoJson: text('song_info_json').notNull(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
})

export const musicImportJobs = sqliteTable('music_import_jobs', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  songName: text('song_name').notNull(),
  singers: text('singers').notNull(),
  status: text('status').notNull(),
  songInfoJson: text('song_info_json').notNull(),
  trackId: text('track_id'),
  errorMessage: text('error_message'),
  progressBytes: integer('progress_bytes', { mode: 'number' }),
  totalBytes: integer('total_bytes', { mode: 'number' }),
  progressPercent: integer('progress_percent', { mode: 'number' }),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  startedAt: integer('started_at', { mode: 'number' }),
  finishedAt: integer('finished_at', { mode: 'number' }),
})

export const playlists = sqliteTable('playlists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
})

export const playlistTracks = sqliteTable('playlist_tracks', {
  playlistId: text('playlist_id').notNull(),
  trackId: text('track_id').notNull(),
  position: integer('position', { mode: 'number' }).notNull(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
}, table => [
  primaryKey({ columns: [table.playlistId, table.trackId] }),
  index('playlist_tracks_playlist_position_idx').on(table.playlistId, table.position),
  index('playlist_tracks_track_idx').on(table.trackId),
])

export type Track = InferSelectModel<typeof tracks>
export type MusicImportCandidate = InferSelectModel<typeof musicImportCandidates>
export type MusicImportJob = InferSelectModel<typeof musicImportJobs>
export type MusicImportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type Playlist = InferSelectModel<typeof playlists>
export type PlaylistTrack = InferSelectModel<typeof playlistTracks>
export interface PlaylistSummary extends Playlist {
  totalDurationSeconds: number
  trackCount: number
}

const sqlite = new Database(config.dbPath)

function rebuildLegacyTracksTable(): void {
  sqlite.exec(`
    BEGIN;

    CREATE TABLE tracks__migrated (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      storage_backend TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      cover_storage_backend TEXT,
      cover_storage_key TEXT,
      cover_content_type TEXT,
      cover_thumb_storage_backend TEXT,
      cover_thumb_storage_key TEXT,
      cover_thumb_content_type TEXT,
      title TEXT,
      artists TEXT,
      album TEXT,
      source TEXT,
      source_identifier TEXT,
      duration_text TEXT,
      duration_seconds INTEGER,
      size INTEGER NOT NULL,
      content_type TEXT,
      lyrics TEXT,
      created_at INTEGER NOT NULL
    );

    INSERT INTO tracks__migrated (
      id,
      filename,
      storage_backend,
      storage_key,
      cover_storage_backend,
      cover_storage_key,
      cover_content_type,
      cover_thumb_storage_backend,
      cover_thumb_storage_key,
      cover_thumb_content_type,
      title,
      artists,
      album,
      source,
      source_identifier,
      duration_text,
      duration_seconds,
      size,
      content_type,
      lyrics,
      created_at
    )
    SELECT
      id,
      filename,
      COALESCE(storage_backend, 's3'),
      storage_key,
      cover_storage_backend,
      cover_storage_key,
      cover_content_type,
      cover_thumb_storage_backend,
      cover_thumb_storage_key,
      cover_thumb_content_type,
      title,
      artists,
      album,
      source,
      source_identifier,
      duration_text,
      duration_seconds,
      size,
      content_type,
      lyrics,
      created_at
    FROM tracks;

    DROP TABLE tracks;
    ALTER TABLE tracks__migrated RENAME TO tracks;

    COMMIT;
  `)
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    cover_storage_backend TEXT,
    cover_storage_key TEXT,
    cover_content_type TEXT,
    cover_thumb_storage_backend TEXT,
    cover_thumb_storage_key TEXT,
    cover_thumb_content_type TEXT,
    title TEXT,
    artists TEXT,
    album TEXT,
    source TEXT,
    source_identifier TEXT,
    duration_text TEXT,
    duration_seconds INTEGER,
    size INTEGER NOT NULL,
    content_type TEXT,
    lyrics TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS music_import_candidates (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    song_name TEXT NOT NULL,
    singers TEXT NOT NULL,
    album TEXT NOT NULL,
    ext TEXT NOT NULL,
    file_size TEXT NOT NULL,
    duration TEXT NOT NULL,
    cover_url TEXT,
    downloadable INTEGER NOT NULL,
    song_info_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS music_import_jobs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    song_name TEXT NOT NULL,
    singers TEXT NOT NULL,
    status TEXT NOT NULL,
    song_info_json TEXT NOT NULL,
    track_id TEXT,
    error_message TEXT,
    progress_bytes INTEGER,
    total_bytes INTEGER,
    progress_percent INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
  );

  CREATE INDEX IF NOT EXISTS playlist_tracks_playlist_position_idx
  ON playlist_tracks (playlist_id, position);

  CREATE INDEX IF NOT EXISTS playlist_tracks_track_idx
  ON playlist_tracks (track_id);
`)

const trackColumns = sqlite.prepare('PRAGMA table_info(tracks)').all() as Array<{ name: string }>
const hasLegacyS3Key = trackColumns.some(column => column.name === 's3_key')
const hasLegacyCoverS3Key = trackColumns.some(column => column.name === 'cover_s3_key')
if (!trackColumns.some(column => column.name === 'storage_backend')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN storage_backend TEXT')
}
if (!trackColumns.some(column => column.name === 'storage_key')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN storage_key TEXT')
}
if (!trackColumns.some(column => column.name === 'cover_storage_backend')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_storage_backend TEXT')
}
if (!trackColumns.some(column => column.name === 'cover_storage_key')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_storage_key TEXT')
}
if (!trackColumns.some(column => column.name === 'cover_content_type')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_content_type TEXT')
}
if (!trackColumns.some(column => column.name === 'cover_thumb_storage_backend')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_thumb_storage_backend TEXT')
}
if (!trackColumns.some(column => column.name === 'cover_thumb_storage_key')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_thumb_storage_key TEXT')
}
if (!trackColumns.some(column => column.name === 'cover_thumb_content_type')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_thumb_content_type TEXT')
}
if (!trackColumns.some(column => column.name === 'title')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN title TEXT')
}
if (!trackColumns.some(column => column.name === 'artists')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN artists TEXT')
}
if (!trackColumns.some(column => column.name === 'album')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN album TEXT')
}
if (!trackColumns.some(column => column.name === 'source')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN source TEXT')
}
if (!trackColumns.some(column => column.name === 'source_identifier')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN source_identifier TEXT')
}
if (!trackColumns.some(column => column.name === 'duration_text')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN duration_text TEXT')
}
if (!trackColumns.some(column => column.name === 'duration_seconds')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN duration_seconds INTEGER')
}
if (!trackColumns.some(column => column.name === 'lyrics')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN lyrics TEXT')
}

if (hasLegacyS3Key) {
  sqlite.exec(`
    UPDATE tracks
    SET
      storage_backend = COALESCE(storage_backend, 's3'),
      storage_key = COALESCE(storage_key, s3_key)
    WHERE storage_backend IS NULL
      OR storage_key IS NULL;
  `)
}
else {
  sqlite.exec(`
    UPDATE tracks
    SET storage_backend = COALESCE(storage_backend, 's3')
    WHERE storage_backend IS NULL;
  `)
}

if (hasLegacyCoverS3Key) {
  sqlite.exec(`
    UPDATE tracks
    SET
      cover_storage_backend = COALESCE(cover_storage_backend, CASE WHEN cover_s3_key IS NOT NULL THEN 's3' END),
      cover_storage_key = COALESCE(cover_storage_key, cover_s3_key)
    WHERE cover_storage_backend IS NULL
      OR cover_storage_key IS NULL;
  `)
}

if (hasLegacyS3Key || hasLegacyCoverS3Key) {
  rebuildLegacyTracksTable()
}

const importJobColumns = sqlite.prepare('PRAGMA table_info(music_import_jobs)').all() as Array<{ name: string }>
if (!importJobColumns.some(column => column.name === 'progress_bytes')) {
  sqlite.exec('ALTER TABLE music_import_jobs ADD COLUMN progress_bytes INTEGER')
}
if (!importJobColumns.some(column => column.name === 'total_bytes')) {
  sqlite.exec('ALTER TABLE music_import_jobs ADD COLUMN total_bytes INTEGER')
}
if (!importJobColumns.some(column => column.name === 'progress_percent')) {
  sqlite.exec('ALTER TABLE music_import_jobs ADD COLUMN progress_percent INTEGER')
}

export const db = drizzle(sqlite)

function normalizePlaylistName(name: string): string {
  return name.trim()
}

function reindexPlaylistTracksWithinTransaction(playlistId: string): void {
  const items = db
    .select({
      trackId: playlistTracks.trackId,
    })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position), asc(playlistTracks.createdAt))
    .all()

  items.forEach((item, index) => {
    db.update(playlistTracks)
      .set({ position: index })
      .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, item.trackId)))
      .run()
  })
}

export function listPlaylists(): PlaylistSummary[] {
  const items = db.select().from(playlists).orderBy(desc(playlists.updatedAt), desc(playlists.createdAt)).all()

  return items.map((playlist) => {
    const aggregates = db
      .select({
        trackCount: sql<number>`count(${playlistTracks.trackId})`,
        totalDurationSeconds: sql<number>`coalesce(sum(${tracks.durationSeconds}), 0)`,
      })
      .from(playlistTracks)
      .leftJoin(tracks, eq(playlistTracks.trackId, tracks.id))
      .where(eq(playlistTracks.playlistId, playlist.id))
      .get()

    return {
      ...playlist,
      trackCount: Number(aggregates?.trackCount ?? 0),
      totalDurationSeconds: Number(aggregates?.totalDurationSeconds ?? 0),
    }
  })
}

export function createPlaylist(input: {
  name: string
  description: string | null
}): Playlist {
  const now = Date.now()
  const record: Playlist = {
    id: randomUUID(),
    name: normalizePlaylistName(input.name),
    description: input.description,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(playlists).values(record).run()
  return record
}

export function getPlaylistById(id: string): Playlist | undefined {
  return db.select().from(playlists).where(eq(playlists.id, id)).get()
}

export function updatePlaylist(id: string, input: {
  name: string
  description: string | null
}): void {
  db.update(playlists)
    .set({
      name: normalizePlaylistName(input.name),
      description: input.description,
      updatedAt: Date.now(),
    })
    .where(eq(playlists.id, id))
    .run()
}

export function deletePlaylist(id: string): void {
  db.transaction(() => {
    db.delete(playlistTracks).where(eq(playlistTracks.playlistId, id)).run()
    db.delete(playlists).where(eq(playlists.id, id)).run()
  })
}

export function getPlaylistTracks(playlistId: string): Track[] {
  const rows = db
    .select({
      track: tracks,
    })
    .from(playlistTracks)
    .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position), asc(playlistTracks.createdAt))
    .all()

  return rows.map(row => row.track)
}

export function getPlaylistTrackIds(playlistId: string): string[] {
  return db
    .select({
      trackId: playlistTracks.trackId,
    })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position), asc(playlistTracks.createdAt))
    .all()
    .map(row => row.trackId)
}

export function addTrackToPlaylist(playlistId: string, trackId: string): void {
  const existing = db.select().from(playlistTracks)
    .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)))
    .get()

  if (existing) {
    throw new Error('Track already exists in playlist')
  }

  const maxPositionRow = db
    .select({
      position: sql<number>`max(${playlistTracks.position})`,
    })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .get()

  db.insert(playlistTracks).values({
    playlistId,
    trackId,
    position: Number(maxPositionRow?.position ?? -1) + 1,
    createdAt: Date.now(),
  }).run()

  db.update(playlists)
    .set({ updatedAt: Date.now() })
    .where(eq(playlists.id, playlistId))
    .run()
}

export function removeTrackFromPlaylist(playlistId: string, trackId: string): boolean {
  return db.transaction(() => {
    const deleted = db.delete(playlistTracks)
      .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)))
      .run()

    if (deleted.changes === 0) {
      return false
    }

    reindexPlaylistTracksWithinTransaction(playlistId)
    db.update(playlists)
      .set({ updatedAt: Date.now() })
      .where(eq(playlists.id, playlistId))
      .run()
    return true
  })
}

export function reorderPlaylistTracks(playlistId: string, orderedTrackIds: string[]): void {
  db.transaction(() => {
    orderedTrackIds.forEach((trackId, index) => {
      db.update(playlistTracks)
        .set({ position: index })
        .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)))
        .run()
    })

    db.update(playlists)
      .set({ updatedAt: Date.now() })
      .where(eq(playlists.id, playlistId))
      .run()
  })
}

export function removeTrackFromAllPlaylists(trackId: string): void {
  const playlistIds = db
    .select({
      playlistId: playlistTracks.playlistId,
    })
    .from(playlistTracks)
    .where(eq(playlistTracks.trackId, trackId))
    .all()
    .map(item => item.playlistId)

  if (playlistIds.length === 0) {
    return
  }

  db.transaction(() => {
    db.delete(playlistTracks).where(eq(playlistTracks.trackId, trackId)).run()
    const uniquePlaylistIds = [...new Set(playlistIds)]
    uniquePlaylistIds.forEach((playlistId) => {
      reindexPlaylistTracksWithinTransaction(playlistId)
      db.update(playlists)
        .set({ updatedAt: Date.now() })
        .where(eq(playlists.id, playlistId))
        .run()
    })
  })
}

export function insertMusicImportCandidates(candidates: Array<Omit<MusicImportCandidate, 'id' | 'createdAt'>>): MusicImportCandidate[] {
  const createdAt = Date.now()
  const records = candidates.map(candidate => ({
    id: randomUUID(),
    createdAt,
    ...candidate,
  }))
  if (records.length > 0) {
    db.insert(musicImportCandidates).values(records).run()
  }
  return records
}

export function pruneExpiredMusicImportCandidates(now = Date.now()): void {
  const cutoff = now - config.importCandidateTtlMs
  db.delete(musicImportCandidates).where(lt(musicImportCandidates.createdAt, cutoff)).run()
}

export function getMusicImportCandidateById(id: string): MusicImportCandidate | undefined {
  return db.select().from(musicImportCandidates).where(eq(musicImportCandidates.id, id)).get()
}

export function createMusicImportJobFromCandidate(candidate: MusicImportCandidate, overrides?: {
  source?: string
  songName?: string
  singers?: string
  songInfoJson?: string
}): MusicImportJob {
  const now = Date.now()
  const record: MusicImportJob = {
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
  db.insert(musicImportJobs).values(record).run()
  return record
}

export function getMusicImportJobById(id: string): MusicImportJob | undefined {
  return db.select().from(musicImportJobs).where(eq(musicImportJobs.id, id)).get()
}

export function requeueRunningMusicImportJobs(): void {
  const now = Date.now()
  db.update(musicImportJobs)
    .set({
      status: 'queued',
      updatedAt: now,
      startedAt: null,
      errorMessage: null,
      progressBytes: 0,
      totalBytes: null,
      progressPercent: null,
    })
    .where(eq(musicImportJobs.status, 'running'))
    .run()
}

export function claimNextQueuedMusicImportJob(): MusicImportJob | null {
  const queuedJob = db
    .select()
    .from(musicImportJobs)
    .where(eq(musicImportJobs.status, 'queued'))
    .orderBy(musicImportJobs.createdAt)
    .get()

  if (!queuedJob) {
    return null
  }

  const now = Date.now()
  const updateResult = db.update(musicImportJobs)
    .set({
      status: 'running',
      updatedAt: now,
      startedAt: now,
      errorMessage: null,
      progressBytes: 0,
      totalBytes: null,
      progressPercent: null,
    })
    .where(and(eq(musicImportJobs.id, queuedJob.id), eq(musicImportJobs.status, 'queued')))
    .run()

  if (updateResult.changes === 0) {
    return null
  }

  return getMusicImportJobById(queuedJob.id) ?? null
}

export function updateMusicImportJobProgress(id: string, progress: {
  progressBytes: number
  totalBytes: number | null
}): void {
  const normalizedProgressBytes = Math.max(0, Math.floor(progress.progressBytes))
  const normalizedTotalBytes = progress.totalBytes === null ? null : Math.max(0, Math.floor(progress.totalBytes))
  const progressPercent = normalizedTotalBytes && normalizedTotalBytes > 0
    ? Math.min(100, Math.floor((normalizedProgressBytes / normalizedTotalBytes) * 100))
    : null

  db.update(musicImportJobs)
    .set({
      progressBytes: normalizedProgressBytes,
      totalBytes: normalizedTotalBytes,
      progressPercent,
      updatedAt: Date.now(),
    })
    .where(eq(musicImportJobs.id, id))
    .run()
}

export function markMusicImportJobSucceeded(id: string, trackId: string, size: number): void {
  const now = Date.now()
  db.update(musicImportJobs)
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
    .where(eq(musicImportJobs.id, id))
    .run()
}

export function markMusicImportJobFailed(id: string, errorMessage: string): void {
  const now = Date.now()
  db.update(musicImportJobs)
    .set({
      status: 'failed',
      errorMessage,
      updatedAt: now,
      finishedAt: now,
    })
    .where(eq(musicImportJobs.id, id))
    .run()
}

export function updateTrackEditableMetadata(id: string, metadata: {
  title: string | null
  artists: string | null
  album: string | null
  source: string | null
  lyrics: string | null
}): void {
  db.update(tracks)
    .set({
      title: metadata.title,
      artists: metadata.artists,
      album: metadata.album,
      source: metadata.source,
      lyrics: metadata.lyrics,
    })
    .where(eq(tracks.id, id))
    .run()
}

export function updateTrackCover(id: string, cover: {
  backend: string | null
  key: string | null
  contentType: string | null
  thumbBackend: string | null
  thumbKey: string | null
  thumbContentType: string | null
}): void {
  db.update(tracks)
    .set({
      coverStorageBackend: cover.backend,
      coverStorageKey: cover.key,
      coverContentType: cover.contentType,
      coverThumbStorageBackend: cover.thumbBackend,
      coverThumbStorageKey: cover.thumbKey,
      coverThumbContentType: cover.thumbContentType,
    })
    .where(eq(tracks.id, id))
    .run()
}

export function getTrackById(id: string): Track | undefined {
  return db.select().from(tracks).where(eq(tracks.id, id)).get()
}

export function updateTrackImportedMetadata(id: string, metadata: {
  coverStorageBackend: string | null
  coverStorageKey: string | null
  coverContentType: string | null
  coverThumbStorageBackend: string | null
  coverThumbStorageKey: string | null
  coverThumbContentType: string | null
  lyrics: string | null
  title: string | null
  artists: string | null
  album: string | null
  source: string | null
  sourceIdentifier: string | null
  durationText: string | null
  durationSeconds: number | null
}): void {
  db.update(tracks)
    .set({
      coverStorageBackend: metadata.coverStorageBackend,
      coverStorageKey: metadata.coverStorageKey,
      coverContentType: metadata.coverContentType,
      coverThumbStorageBackend: metadata.coverThumbStorageBackend,
      coverThumbStorageKey: metadata.coverThumbStorageKey,
      coverThumbContentType: metadata.coverThumbContentType,
      lyrics: metadata.lyrics,
      title: metadata.title,
      artists: metadata.artists,
      album: metadata.album,
      source: metadata.source,
      sourceIdentifier: metadata.sourceIdentifier,
      durationText: metadata.durationText,
      durationSeconds: metadata.durationSeconds,
    })
    .where(eq(tracks.id, id))
    .run()
}
