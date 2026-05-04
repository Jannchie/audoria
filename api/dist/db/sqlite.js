import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { setDb } from './index.js';
function rebuildLegacyTracksTable(sqlite) {
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
      cover_thumbhash TEXT,
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
      cover_thumbhash,
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
      cover_thumbhash,
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
  `);
}
export function initSqlite(dbPath) {
    const sqlite = new Database(dbPath);
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
      cover_thumbhash TEXT,
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
  `);
    // Legacy migration: add missing columns
    const trackColumns = sqlite.prepare('PRAGMA table_info(tracks)').all();
    const hasLegacyS3Key = trackColumns.some(column => column.name === 's3_key');
    const hasLegacyCoverS3Key = trackColumns.some(column => column.name === 'cover_s3_key');
    if (!trackColumns.some(column => column.name === 'storage_backend')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN storage_backend TEXT');
    }
    if (!trackColumns.some(column => column.name === 'storage_key')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN storage_key TEXT');
    }
    if (!trackColumns.some(column => column.name === 'cover_storage_backend')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_storage_backend TEXT');
    }
    if (!trackColumns.some(column => column.name === 'cover_storage_key')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_storage_key TEXT');
    }
    if (!trackColumns.some(column => column.name === 'cover_content_type')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_content_type TEXT');
    }
    if (!trackColumns.some(column => column.name === 'cover_thumb_storage_backend')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_thumb_storage_backend TEXT');
    }
    if (!trackColumns.some(column => column.name === 'cover_thumb_storage_key')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_thumb_storage_key TEXT');
    }
    if (!trackColumns.some(column => column.name === 'cover_thumb_content_type')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_thumb_content_type TEXT');
    }
    if (!trackColumns.some(column => column.name === 'cover_thumbhash')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN cover_thumbhash TEXT');
    }
    if (!trackColumns.some(column => column.name === 'title')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN title TEXT');
    }
    if (!trackColumns.some(column => column.name === 'artists')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN artists TEXT');
    }
    if (!trackColumns.some(column => column.name === 'album')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN album TEXT');
    }
    if (!trackColumns.some(column => column.name === 'source')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN source TEXT');
    }
    if (!trackColumns.some(column => column.name === 'source_identifier')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN source_identifier TEXT');
    }
    if (!trackColumns.some(column => column.name === 'duration_text')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN duration_text TEXT');
    }
    if (!trackColumns.some(column => column.name === 'duration_seconds')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN duration_seconds INTEGER');
    }
    if (!trackColumns.some(column => column.name === 'lyrics')) {
        sqlite.exec('ALTER TABLE tracks ADD COLUMN lyrics TEXT');
    }
    if (hasLegacyS3Key) {
        sqlite.exec(`
      UPDATE tracks
      SET
        storage_backend = COALESCE(storage_backend, 's3'),
        storage_key = COALESCE(storage_key, s3_key)
      WHERE storage_backend IS NULL
        OR storage_key IS NULL;
    `);
    }
    else {
        sqlite.exec(`
      UPDATE tracks
      SET storage_backend = COALESCE(storage_backend, 's3')
      WHERE storage_backend IS NULL;
    `);
    }
    if (hasLegacyCoverS3Key) {
        sqlite.exec(`
      UPDATE tracks
      SET
        cover_storage_backend = COALESCE(cover_storage_backend, CASE WHEN cover_s3_key IS NOT NULL THEN 's3' END),
        cover_storage_key = COALESCE(cover_storage_key, cover_s3_key)
      WHERE cover_storage_backend IS NULL
        OR cover_storage_key IS NULL;
    `);
    }
    if (hasLegacyS3Key || hasLegacyCoverS3Key) {
        rebuildLegacyTracksTable(sqlite);
    }
    const importJobColumns = sqlite.prepare('PRAGMA table_info(music_import_jobs)').all();
    if (!importJobColumns.some(column => column.name === 'progress_bytes')) {
        sqlite.exec('ALTER TABLE music_import_jobs ADD COLUMN progress_bytes INTEGER');
    }
    if (!importJobColumns.some(column => column.name === 'total_bytes')) {
        sqlite.exec('ALTER TABLE music_import_jobs ADD COLUMN total_bytes INTEGER');
    }
    if (!importJobColumns.some(column => column.name === 'progress_percent')) {
        sqlite.exec('ALTER TABLE music_import_jobs ADD COLUMN progress_percent INTEGER');
    }
    const drizzleDb = drizzle(sqlite);
    setDb(drizzleDb, 'sqlite');
}
