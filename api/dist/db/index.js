import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { config } from '../config.js';
import * as schema from './schema.js';
let db;
let driver = 'sqlite';
export function getDriver() {
    return driver;
}
export function setDb(drizzleInstance, dbDriver) {
    db = drizzleInstance;
    driver = dbDriver;
}
/** @internal used by storage.ts */
export { db as __db };
// Re-export schema tables for direct use
export { tracks } from './schema.js';
function normalizePlaylistName(name) {
    return name.trim();
}
function reindexPlaylistTracksWithinTransaction(playlistId) {
    const items = db
        .select({
        trackId: schema.playlistTracks.trackId,
    })
        .from(schema.playlistTracks)
        .where(eq(schema.playlistTracks.playlistId, playlistId))
        .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt))
        .all();
    for (const [index, item] of items.entries()) {
        db.update(schema.playlistTracks)
            .set({ position: index })
            .where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, item.trackId)))
            .run();
    }
}
// ── Track queries ──
export async function listTracks() {
    return db.select().from(schema.tracks).orderBy(desc(schema.tracks.createdAt)).all();
}
export async function getTrackById(id) {
    return db.select().from(schema.tracks).where(eq(schema.tracks.id, id)).get();
}
export async function updateTrackEditableMetadata(id, metadata) {
    db.update(schema.tracks)
        .set({
        title: metadata.title,
        artists: metadata.artists,
        album: metadata.album,
        source: metadata.source,
        lyrics: metadata.lyrics,
    })
        .where(eq(schema.tracks.id, id))
        .run();
}
export async function updateTrackCover(id, cover) {
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
        .run();
}
export async function updateTrackImportedMetadata(id, metadata) {
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
        .run();
}
export async function deleteTrackRecord(id) {
    db.delete(schema.tracks).where(eq(schema.tracks.id, id)).run();
}
// ── Playlist queries ──
export async function listPlaylists() {
    const items = db.select().from(schema.playlists).orderBy(desc(schema.playlists.updatedAt), desc(schema.playlists.createdAt)).all();
    return items.map((playlist) => {
        const aggregates = db
            .select({
            trackCount: sql `count(${schema.playlistTracks.trackId})`,
            totalDurationSeconds: sql `coalesce(sum(${schema.tracks.durationSeconds}), 0)`,
        })
            .from(schema.playlistTracks)
            .leftJoin(schema.tracks, eq(schema.playlistTracks.trackId, schema.tracks.id))
            .where(eq(schema.playlistTracks.playlistId, playlist.id))
            .get();
        const previewCovers = db
            .select({
            trackId: schema.playlistTracks.trackId,
            coverThumbhash: schema.tracks.coverThumbhash,
        })
            .from(schema.playlistTracks)
            .innerJoin(schema.tracks, eq(schema.playlistTracks.trackId, schema.tracks.id))
            .where(and(eq(schema.playlistTracks.playlistId, playlist.id), sql `(${schema.tracks.coverThumbStorageKey} IS NOT NULL OR ${schema.tracks.coverStorageKey} IS NOT NULL)`))
            .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt))
            .limit(4)
            .all();
        return {
            ...playlist,
            trackCount: Number(aggregates?.trackCount ?? 0),
            totalDurationSeconds: Number(aggregates?.totalDurationSeconds ?? 0),
            previewTrackIds: previewCovers.map(row => row.trackId),
            previewCoverThumbhashes: previewCovers.map(row => row.coverThumbhash),
        };
    });
}
export async function createPlaylist(input) {
    const now = Date.now();
    const record = {
        id: randomUUID(),
        name: normalizePlaylistName(input.name),
        description: input.description,
        createdAt: now,
        updatedAt: now,
    };
    db.insert(schema.playlists).values(record).run();
    return record;
}
export async function getPlaylistById(id) {
    return db.select().from(schema.playlists).where(eq(schema.playlists.id, id)).get();
}
export async function updatePlaylist(id, input) {
    db.update(schema.playlists)
        .set({
        name: normalizePlaylistName(input.name),
        description: input.description,
        updatedAt: Date.now(),
    })
        .where(eq(schema.playlists.id, id))
        .run();
}
export async function deletePlaylist(id) {
    db.transaction(() => {
        db.delete(schema.playlistTracks).where(eq(schema.playlistTracks.playlistId, id)).run();
        db.delete(schema.playlists).where(eq(schema.playlists.id, id)).run();
    });
}
export async function getPlaylistTracks(playlistId) {
    const rows = db
        .select({
        track: schema.tracks,
    })
        .from(schema.playlistTracks)
        .innerJoin(schema.tracks, eq(schema.playlistTracks.trackId, schema.tracks.id))
        .where(eq(schema.playlistTracks.playlistId, playlistId))
        .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt))
        .all();
    return rows.map(row => row.track);
}
export async function getPlaylistTrackIds(playlistId) {
    const rows = db
        .select({
        trackId: schema.playlistTracks.trackId,
    })
        .from(schema.playlistTracks)
        .where(eq(schema.playlistTracks.playlistId, playlistId))
        .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt))
        .all();
    return rows.map(row => row.trackId);
}
export async function addTrackToPlaylist(playlistId, trackId) {
    const existing = db.select().from(schema.playlistTracks).where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, trackId))).get();
    if (existing) {
        throw new Error('Track already exists in playlist');
    }
    const maxPositionRow = db
        .select({
        position: sql `max(${schema.playlistTracks.position})`,
    })
        .from(schema.playlistTracks)
        .where(eq(schema.playlistTracks.playlistId, playlistId))
        .get();
    db.insert(schema.playlistTracks).values({
        playlistId,
        trackId,
        position: Number(maxPositionRow?.position ?? -1) + 1,
        createdAt: Date.now(),
    }).run();
    db.update(schema.playlists)
        .set({ updatedAt: Date.now() })
        .where(eq(schema.playlists.id, playlistId))
        .run();
}
export async function removeTrackFromPlaylist(playlistId, trackId) {
    return db.transaction(() => {
        const deleted = db.delete(schema.playlistTracks)
            .where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, trackId)))
            .run();
        if (deleted.changes === 0) {
            return false;
        }
        reindexPlaylistTracksWithinTransaction(playlistId);
        db.update(schema.playlists)
            .set({ updatedAt: Date.now() })
            .where(eq(schema.playlists.id, playlistId))
            .run();
        return true;
    });
}
export async function reorderPlaylistTracks(playlistId, orderedTrackIds) {
    db.transaction(() => {
        for (const [index, trackId] of orderedTrackIds.entries()) {
            db.update(schema.playlistTracks)
                .set({ position: index })
                .where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, trackId)))
                .run();
        }
        db.update(schema.playlists)
            .set({ updatedAt: Date.now() })
            .where(eq(schema.playlists.id, playlistId))
            .run();
    });
}
export async function getPlaylistIdsForTracks(trackIds) {
    const map = new Map();
    if (trackIds.length === 0) {
        return map;
    }
    const rows = db
        .select({
        trackId: schema.playlistTracks.trackId,
        playlistId: schema.playlistTracks.playlistId,
    })
        .from(schema.playlistTracks)
        .where(inArray(schema.playlistTracks.trackId, trackIds))
        .all();
    for (const row of rows) {
        const list = map.get(row.trackId);
        if (list) {
            list.push(row.playlistId);
        }
        else {
            map.set(row.trackId, [row.playlistId]);
        }
    }
    return map;
}
export async function listAllTrackPlaylistPairs() {
    const rows = db
        .select({
        trackId: schema.playlistTracks.trackId,
        playlistId: schema.playlistTracks.playlistId,
    })
        .from(schema.playlistTracks)
        .all();
    const map = new Map();
    for (const row of rows) {
        const list = map.get(row.trackId);
        if (list) {
            list.push(row.playlistId);
        }
        else {
            map.set(row.trackId, [row.playlistId]);
        }
    }
    return map;
}
export async function removeTrackFromAllPlaylists(trackId) {
    const playlistIds = db
        .select({
        playlistId: schema.playlistTracks.playlistId,
    })
        .from(schema.playlistTracks)
        .where(eq(schema.playlistTracks.trackId, trackId))
        .all();
    if (playlistIds.length === 0) {
        return;
    }
    db.transaction(() => {
        db.delete(schema.playlistTracks).where(eq(schema.playlistTracks.trackId, trackId)).run();
        const uniquePlaylistIds = [...new Set(playlistIds.map(p => p.playlistId))];
        for (const playlistId of uniquePlaylistIds) {
            reindexPlaylistTracksWithinTransaction(playlistId);
            db.update(schema.playlists)
                .set({ updatedAt: Date.now() })
                .where(eq(schema.playlists.id, playlistId))
                .run();
        }
    });
}
// ── Music import candidate queries ──
export async function insertMusicImportCandidates(candidates) {
    const createdAt = Date.now();
    const records = candidates.map(candidate => ({
        id: randomUUID(),
        createdAt,
        ...candidate,
    }));
    if (records.length > 0) {
        db.insert(schema.musicImportCandidates).values(records).run();
    }
    return records;
}
export async function pruneExpiredMusicImportCandidates(now = Date.now()) {
    const cutoff = now - config.importCandidateTtlMs;
    db.delete(schema.musicImportCandidates).where(lt(schema.musicImportCandidates.createdAt, cutoff)).run();
}
export async function getMusicImportCandidateById(id) {
    return db.select().from(schema.musicImportCandidates).where(eq(schema.musicImportCandidates.id, id)).get();
}
// ── Music import job queries ──
export async function createMusicImportJobFromCandidate(candidate, overrides) {
    const now = Date.now();
    const record = {
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
    };
    db.insert(schema.musicImportJobs).values(record).run();
    return record;
}
export async function getMusicImportJobById(id) {
    return db.select().from(schema.musicImportJobs).where(eq(schema.musicImportJobs.id, id)).get();
}
export async function requeueRunningMusicImportJobs() {
    const now = Date.now();
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
        .run();
}
export async function claimNextQueuedMusicImportJob() {
    const queuedJob = db
        .select()
        .from(schema.musicImportJobs)
        .where(eq(schema.musicImportJobs.status, 'queued'))
        .orderBy(schema.musicImportJobs.createdAt)
        .get();
    if (!queuedJob) {
        return null;
    }
    const now = Date.now();
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
        .run();
    if (updateResult.changes === 0) {
        return null;
    }
    return (await getMusicImportJobById(queuedJob.id)) ?? null;
}
export async function updateMusicImportJobProgress(id, progress) {
    const normalizedProgressBytes = Math.max(0, Math.floor(progress.progressBytes));
    const normalizedTotalBytes = progress.totalBytes === null ? null : Math.max(0, Math.floor(progress.totalBytes));
    const progressPercent = normalizedTotalBytes && normalizedTotalBytes > 0
        ? Math.min(100, Math.floor((normalizedProgressBytes / normalizedTotalBytes) * 100))
        : null;
    db.update(schema.musicImportJobs)
        .set({
        progressBytes: normalizedProgressBytes,
        totalBytes: normalizedTotalBytes,
        progressPercent,
        updatedAt: Date.now(),
    })
        .where(eq(schema.musicImportJobs.id, id))
        .run();
}
export async function markMusicImportJobSucceeded(id, trackId, size) {
    const now = Date.now();
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
        .run();
}
export async function markMusicImportJobFailed(id, errorMessage) {
    const now = Date.now();
    db.update(schema.musicImportJobs)
        .set({
        status: 'failed',
        errorMessage,
        updatedAt: now,
        finishedAt: now,
    })
        .where(eq(schema.musicImportJobs.id, id))
        .run();
}
