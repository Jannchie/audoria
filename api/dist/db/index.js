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
export { db as __db };
// Re-export schema tables for direct use
export { tracks } from './schema.js';
async function queryAll(query) {
    return await query.all();
}
async function queryGet(query) {
    return await query.get();
}
async function queryRun(query) {
    return await query.run();
}
async function runTransaction(callback) {
    if (driver === 'sqlite') {
        return await db.transaction(callback);
    }
    return await callback();
}
function normalizePlaylistName(name) {
    return name.trim();
}
async function reindexPlaylistTracksWithinTransaction(playlistId) {
    const items = await queryAll(db
        .select({
        trackId: schema.playlistTracks.trackId,
    })
        .from(schema.playlistTracks)
        .where(eq(schema.playlistTracks.playlistId, playlistId))
        .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt)));
    for (const [index, item] of items.entries()) {
        await queryRun(db.update(schema.playlistTracks)
            .set({ position: index })
            .where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, item.trackId))));
    }
}
// ── Track queries ──
export async function listTracks() {
    return await queryAll(db.select().from(schema.tracks).orderBy(desc(schema.tracks.createdAt)));
}
export async function getTrackById(id) {
    return await queryGet(db.select().from(schema.tracks).where(eq(schema.tracks.id, id)));
}
export async function updateTrackEditableMetadata(id, metadata) {
    await queryRun(db.update(schema.tracks)
        .set({
        title: metadata.title,
        artists: metadata.artists,
        album: metadata.album,
        source: metadata.source,
        lyrics: metadata.lyrics,
    })
        .where(eq(schema.tracks.id, id)));
}
export async function updateTrackCover(id, cover) {
    await queryRun(db.update(schema.tracks)
        .set({
        coverStorageBackend: cover.backend,
        coverStorageKey: cover.key,
        coverContentType: cover.contentType,
        coverThumbStorageBackend: cover.thumbBackend,
        coverThumbStorageKey: cover.thumbKey,
        coverThumbContentType: cover.thumbContentType,
        coverThumbhash: cover.thumbhash,
    })
        .where(eq(schema.tracks.id, id)));
}
export async function updateTrackImportedMetadata(id, metadata) {
    await queryRun(db.update(schema.tracks)
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
        .where(eq(schema.tracks.id, id)));
}
export async function deleteTrackRecord(id) {
    await queryRun(db.delete(schema.tracks).where(eq(schema.tracks.id, id)));
}
// ── Playlist queries ──
export async function listPlaylists() {
    const items = await queryAll(db.select().from(schema.playlists).orderBy(desc(schema.playlists.updatedAt), desc(schema.playlists.createdAt)));
    return await Promise.all(items.map(async (playlist) => {
        const aggregates = await queryGet(db
            .select({
            trackCount: sql `count(${schema.playlistTracks.trackId})`,
            totalDurationSeconds: sql `coalesce(sum(${schema.tracks.durationSeconds}), 0)`,
        })
            .from(schema.playlistTracks)
            .leftJoin(schema.tracks, eq(schema.playlistTracks.trackId, schema.tracks.id))
            .where(eq(schema.playlistTracks.playlistId, playlist.id)));
        const previewCovers = await queryAll(db
            .select({
            trackId: schema.playlistTracks.trackId,
            coverThumbhash: schema.tracks.coverThumbhash,
        })
            .from(schema.playlistTracks)
            .innerJoin(schema.tracks, eq(schema.playlistTracks.trackId, schema.tracks.id))
            .where(and(eq(schema.playlistTracks.playlistId, playlist.id), sql `(${schema.tracks.coverThumbStorageKey} IS NOT NULL OR ${schema.tracks.coverStorageKey} IS NOT NULL)`))
            .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt))
            .limit(4));
        return {
            ...playlist,
            trackCount: Number(aggregates?.trackCount ?? 0),
            totalDurationSeconds: Number(aggregates?.totalDurationSeconds ?? 0),
            previewTrackIds: previewCovers.map(row => row.trackId),
            previewCoverThumbhashes: previewCovers.map(row => row.coverThumbhash),
        };
    }));
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
    await queryRun(db.insert(schema.playlists).values(record));
    return record;
}
export async function getPlaylistById(id) {
    return await queryGet(db.select().from(schema.playlists).where(eq(schema.playlists.id, id)));
}
export async function updatePlaylist(id, input) {
    await queryRun(db.update(schema.playlists)
        .set({
        name: normalizePlaylistName(input.name),
        description: input.description,
        updatedAt: Date.now(),
    })
        .where(eq(schema.playlists.id, id)));
}
export async function deletePlaylist(id) {
    await runTransaction(async () => {
        await queryRun(db.delete(schema.playlistTracks).where(eq(schema.playlistTracks.playlistId, id)));
        await queryRun(db.delete(schema.playlists).where(eq(schema.playlists.id, id)));
    });
}
export async function getPlaylistTracks(playlistId) {
    const rows = await queryAll(db
        .select({
        track: schema.tracks,
    })
        .from(schema.playlistTracks)
        .innerJoin(schema.tracks, eq(schema.playlistTracks.trackId, schema.tracks.id))
        .where(eq(schema.playlistTracks.playlistId, playlistId))
        .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt)));
    return rows.map(row => row.track);
}
export async function getPlaylistTrackIds(playlistId) {
    const rows = await queryAll(db
        .select({
        trackId: schema.playlistTracks.trackId,
    })
        .from(schema.playlistTracks)
        .where(eq(schema.playlistTracks.playlistId, playlistId))
        .orderBy(asc(schema.playlistTracks.position), asc(schema.playlistTracks.createdAt)));
    return rows.map(row => row.trackId);
}
export async function addTrackToPlaylist(playlistId, trackId) {
    const existing = await queryGet(db.select().from(schema.playlistTracks).where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, trackId))));
    if (existing) {
        throw new Error('Track already exists in playlist');
    }
    const maxPositionRow = await queryGet(db
        .select({
        position: sql `max(${schema.playlistTracks.position})`,
    })
        .from(schema.playlistTracks)
        .where(eq(schema.playlistTracks.playlistId, playlistId)));
    await queryRun(db.insert(schema.playlistTracks).values({
        playlistId,
        trackId,
        position: Number(maxPositionRow?.position ?? -1) + 1,
        createdAt: Date.now(),
    }));
    await queryRun(db.update(schema.playlists)
        .set({ updatedAt: Date.now() })
        .where(eq(schema.playlists.id, playlistId)));
}
export async function removeTrackFromPlaylist(playlistId, trackId) {
    return await runTransaction(async () => {
        const deleted = await queryRun(db.delete(schema.playlistTracks)
            .where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, trackId))));
        if (deleted.changes === 0) {
            return false;
        }
        await reindexPlaylistTracksWithinTransaction(playlistId);
        await queryRun(db.update(schema.playlists)
            .set({ updatedAt: Date.now() })
            .where(eq(schema.playlists.id, playlistId)));
        return true;
    });
}
export async function reorderPlaylistTracks(playlistId, orderedTrackIds) {
    await runTransaction(async () => {
        for (const [index, trackId] of orderedTrackIds.entries()) {
            await queryRun(db.update(schema.playlistTracks)
                .set({ position: index })
                .where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.trackId, trackId))));
        }
        await queryRun(db.update(schema.playlists)
            .set({ updatedAt: Date.now() })
            .where(eq(schema.playlists.id, playlistId)));
    });
}
export async function getPlaylistIdsForTracks(trackIds) {
    const map = new Map();
    if (trackIds.length === 0) {
        return map;
    }
    const rows = await queryAll(db
        .select({
        trackId: schema.playlistTracks.trackId,
        playlistId: schema.playlistTracks.playlistId,
    })
        .from(schema.playlistTracks)
        .where(inArray(schema.playlistTracks.trackId, trackIds)));
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
    const rows = await queryAll(db
        .select({
        trackId: schema.playlistTracks.trackId,
        playlistId: schema.playlistTracks.playlistId,
    })
        .from(schema.playlistTracks));
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
    const playlistIds = await queryAll(db
        .select({
        playlistId: schema.playlistTracks.playlistId,
    })
        .from(schema.playlistTracks)
        .where(eq(schema.playlistTracks.trackId, trackId)));
    if (playlistIds.length === 0) {
        return;
    }
    await runTransaction(async () => {
        await queryRun(db.delete(schema.playlistTracks).where(eq(schema.playlistTracks.trackId, trackId)));
        const uniquePlaylistIds = [...new Set(playlistIds.map(p => p.playlistId))];
        for (const playlistId of uniquePlaylistIds) {
            await reindexPlaylistTracksWithinTransaction(playlistId);
            await queryRun(db.update(schema.playlists)
                .set({ updatedAt: Date.now() })
                .where(eq(schema.playlists.id, playlistId)));
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
        await queryRun(db.insert(schema.musicImportCandidates).values(records));
    }
    return records;
}
export async function pruneExpiredMusicImportCandidates(now = Date.now()) {
    const cutoff = now - config.importCandidateTtlMs;
    await queryRun(db.delete(schema.musicImportCandidates).where(lt(schema.musicImportCandidates.createdAt, cutoff)));
}
export async function getMusicImportCandidateById(id) {
    return await queryGet(db.select().from(schema.musicImportCandidates).where(eq(schema.musicImportCandidates.id, id)));
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
    await queryRun(db.insert(schema.musicImportJobs).values(record));
    return record;
}
export async function getMusicImportJobById(id) {
    return await queryGet(db.select().from(schema.musicImportJobs).where(eq(schema.musicImportJobs.id, id)));
}
export async function requeueRunningMusicImportJobs() {
    const now = Date.now();
    await queryRun(db.update(schema.musicImportJobs)
        .set({
        status: 'queued',
        updatedAt: now,
        startedAt: null,
        errorMessage: null,
        progressBytes: 0,
        totalBytes: null,
        progressPercent: null,
    })
        .where(eq(schema.musicImportJobs.status, 'running')));
}
export async function claimNextQueuedMusicImportJob() {
    const queuedJob = await queryGet(db
        .select()
        .from(schema.musicImportJobs)
        .where(eq(schema.musicImportJobs.status, 'queued'))
        .orderBy(schema.musicImportJobs.createdAt));
    if (!queuedJob) {
        return null;
    }
    const now = Date.now();
    const updateResult = await queryRun(db.update(schema.musicImportJobs)
        .set({
        status: 'running',
        updatedAt: now,
        startedAt: now,
        errorMessage: null,
        progressBytes: 0,
        totalBytes: null,
        progressPercent: null,
    })
        .where(and(eq(schema.musicImportJobs.id, queuedJob.id), eq(schema.musicImportJobs.status, 'queued'))));
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
    await queryRun(db.update(schema.musicImportJobs)
        .set({
        progressBytes: normalizedProgressBytes,
        totalBytes: normalizedTotalBytes,
        progressPercent,
        updatedAt: Date.now(),
    })
        .where(eq(schema.musicImportJobs.id, id)));
}
export async function markMusicImportJobSucceeded(id, trackId, size) {
    const now = Date.now();
    await queryRun(db.update(schema.musicImportJobs)
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
        .where(eq(schema.musicImportJobs.id, id)));
}
export async function markMusicImportJobFailed(id, errorMessage) {
    const now = Date.now();
    await queryRun(db.update(schema.musicImportJobs)
        .set({
        status: 'failed',
        errorMessage,
        updatedAt: now,
        finishedAt: now,
    })
        .where(eq(schema.musicImportJobs.id, id)));
}
