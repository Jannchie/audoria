import type { MusicDlSongInfo } from './musicdl.js'
import type { ReadableStream } from 'node:stream/web'
import { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from './config.js'
import {
  claimNextQueuedMusicImportJob,
  markMusicImportJobFailed,
  markMusicImportJobSucceeded,
  requeueRunningMusicImportJobs,
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
    const track = await storeTrack({
      filename: imported.filename,
      contentType: imported.contentType,
      size: imported.contentLength ?? songInfo.file_size_bytes,
      body: Readable.fromWeb(imported.body as unknown as ReadableStream),
    })

    let coverS3Key: string | null = null
    if (songInfo.cover_url) {
      try {
        const cover = await fetchCoverAsset(songInfo.cover_url)
        if (cover) {
          coverS3Key = await storeTrackCover({
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
      coverS3Key,
      lyrics: songInfo.lyric,
      title: songInfo.song_name,
      artists: songInfo.singers,
      album: songInfo.album,
      source: songInfo.source,
      durationText: songInfo.duration,
      durationSeconds: songInfo.duration_s,
    })

    markMusicImportJobSucceeded(job.id, track.id)
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

// eslint-disable-next-line unicorn/prefer-top-level-await
void run()
