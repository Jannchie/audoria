import type { ReadableStream } from 'node:stream/web'
import type { MusicDlSongInfo } from './musicdl.js'
import { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from './config.js'
import {
  claimNextQueuedMusicImportJob,
  markMusicImportJobFailed,
  markMusicImportJobSucceeded,
  requeueRunningMusicImportJobs,
  updateMusicImportJobProgress,
  updateTrackImportedMetadata,
} from './db.js'
import { MusicDlBridgeError, MusicDlUnavailableError, openMusicDlStream } from './musicdl.js'
import { storeTrack, storeTrackCover } from './storage.js'

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown import error'
}

function toSourceIdentifier(identifier: MusicDlSongInfo['identifier']): string | null {
  if (identifier === null || identifier === undefined) {
    return null
  }
  const value = String(identifier).trim()
  return value || null
}

async function fetchCoverAsset(coverUrl: string): Promise<{ body: Uint8Array, contentType: string | null } | null> {
  const response = await fetch(coverUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch cover: ${response.status} ${response.statusText}`)
  }
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength === 0) {
    return null
  }
  return {
    body,
    contentType: response.headers.get('content-type'),
  }
}

async function processNextJob(): Promise<boolean> {
  const job = claimNextQueuedMusicImportJob()
  if (!job) {
    return false
  }

  try {
    const songInfo = JSON.parse(job.songInfoJson) as MusicDlSongInfo
    const imported = await openMusicDlStream(songInfo, config.musicdl)
    const totalBytes = imported.contentLength ?? songInfo.file_size_bytes
    let lastProgressAt = 0
    updateMusicImportJobProgress(job.id, {
      progressBytes: 0,
      totalBytes: totalBytes ?? null,
    })

    const track = await storeTrack({
      filename: imported.filename,
      contentType: imported.contentType,
      size: totalBytes,
      body: Readable.fromWeb(imported.body as unknown as ReadableStream),
      onProgress: (progressBytes) => {
        const now = Date.now()
        if (now - lastProgressAt < 200 && (!totalBytes || progressBytes < totalBytes)) {
          return
        }
        lastProgressAt = now
        updateMusicImportJobProgress(job.id, {
          progressBytes,
          totalBytes: totalBytes ?? null,
        })
      },
    })

    let storedCover: Awaited<ReturnType<typeof storeTrackCover>> | null = null
    if (songInfo.cover_url) {
      try {
        const cover = await fetchCoverAsset(songInfo.cover_url)
        if (cover) {
          storedCover = await storeTrackCover({
            trackId: track.id,
            contentType: cover.contentType,
            size: cover.body.byteLength,
            body: cover.body,
          })
        }
      }
      catch (error) {
        console.warn(`Failed to fetch cover for ${track.id}: ${toErrorMessage(error)}`)
      }
    }

    updateTrackImportedMetadata(track.id, {
      coverStorageBackend: storedCover?.backend ?? null,
      coverStorageKey: storedCover?.key ?? null,
      coverContentType: storedCover?.contentType ?? null,
      lyrics: songInfo.lyric,
      title: songInfo.song_name,
      artists: songInfo.singers,
      album: songInfo.album,
      source: songInfo.source,
      sourceIdentifier: toSourceIdentifier(songInfo.identifier),
      durationText: track.durationText ?? songInfo.duration,
      durationSeconds: track.durationSeconds ?? songInfo.duration_s,
    })

    markMusicImportJobSucceeded(job.id, track.id, track.size)
  }
  catch (error) {
    const message = error instanceof MusicDlUnavailableError || error instanceof MusicDlBridgeError
      ? error.message
      : toErrorMessage(error)
    markMusicImportJobFailed(job.id, message)
  }

  return true
}

async function main(): Promise<void> {
  requeueRunningMusicImportJobs()
  console.warn('Import worker is running')

  while (true) {
    const processed = await processNextJob()
    if (!processed) {
      await sleep(config.importWorkerPollMs)
    }
  }
}

async function run(): Promise<void> {
  try {
    await main()
  }
  catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

void run()
