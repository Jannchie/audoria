import type { InferSelectModel } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { and, eq, lt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { config } from './config.js'

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  s3Key: text('s3_key').notNull(),
  coverS3Key: text('cover_s3_key'),
  title: text('title'),
  artists: text('artists'),
  album: text('album'),
  source: text('source'),
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

export type Track = InferSelectModel<typeof tracks>
export type MusicImportCandidate = InferSelectModel<typeof musicImportCandidates>
export type MusicImportJob = InferSelectModel<typeof musicImportJobs>
export type MusicImportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

const sqlite = new Database(config.dbPath)

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    s3_key TEXT NOT NULL,
    cover_s3_key TEXT,
    title TEXT,
    artists TEXT,
    album TEXT,
    source TEXT,
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
`)

const trackColumns = sqlite.prepare('PRAGMA table_info(tracks)').all() as Array<{ name: string }>
if (!trackColumns.some(column => column.name === 'cover_s3_key')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_s3_key TEXT')
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
if (!trackColumns.some(column => column.name === 'duration_text')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN duration_text TEXT')
}
if (!trackColumns.some(column => column.name === 'duration_seconds')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN duration_seconds INTEGER')
}
if (!trackColumns.some(column => column.name === 'lyrics')) {
  sqlite.exec('ALTER TABLE tracks ADD COLUMN lyrics TEXT')
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

export function updateTrackImportedMetadata(id: string, metadata: {
  coverS3Key: string | null
  lyrics: string | null
  title: string | null
  artists: string | null
  album: string | null
  source: string | null
  durationText: string | null
  durationSeconds: number | null
}): void {
  db.update(tracks)
    .set({
      coverS3Key: metadata.coverS3Key,
      lyrics: metadata.lyrics,
      title: metadata.title,
      artists: metadata.artists,
      album: metadata.album,
      source: metadata.source,
      durationText: metadata.durationText,
      durationSeconds: metadata.durationSeconds,
    })
    .where(eq(tracks.id, id))
    .run()
}
