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
