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
} from './db/index.js'
import { initRuntimeDb } from './db/runtime.js'
import { MusicDlBridgeError, MusicDlUnavailableError, openMusicDlStream } from './musicdl.js'
import { storeTrack, storeTrackCover } from './storage.js'

const coverFetchTimeoutMs = 15_000
const maxCoverAssetBytes = 20 * 1024 * 1024

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

function readContentLength(response: Response): number | null {
  const raw = response.headers.get('content-length')
  if (!raw) {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

async function readLimitedResponseBody(response: Response): Promise<Uint8Array> {
  const contentLength = readContentLength(response)
  if (contentLength !== null && contentLength > maxCoverAssetBytes) {
    throw new Error(`Cover image exceeds ${maxCoverAssetBytes} bytes`)
  }

  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength > maxCoverAssetBytes) {
      throw new Error(`Cover image exceeds ${maxCoverAssetBytes} bytes`)
    }
    return body
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (!value) {
        continue
      }
      totalBytes += value.byteLength
      if (totalBytes > maxCoverAssetBytes) {
        await reader.cancel().catch(() => {})
        throw new Error(`Cover image exceeds ${maxCoverAssetBytes} bytes`)
      }
      chunks.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function fetchCoverAsset(coverUrl: string): Promise<{ body: Uint8Array, contentType: string | null } | null> {
  const abortController = new AbortController()
  const timeout = globalThis.setTimeout(() => abortController.abort(), coverFetchTimeoutMs)
  try {
    const response = await fetch(coverUrl, { signal: abortController.signal })
    if (!response.ok) {
      throw new Error(`Failed to fetch cover: ${response.status} ${response.statusText}`)
    }
    const body = await readLimitedResponseBody(response)
    if (body.byteLength === 0) {
      return null
    }
    return {
      body,
      contentType: response.headers.get('content-type'),
    }
  }
  finally {
    globalThis.clearTimeout(timeout)
  }
}

async function processNextJob(): Promise<boolean> {
  const job = await claimNextQueuedMusicImportJob()
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
            body: cover.body,
          })
        }
      }
      catch (error) {
        console.warn(`Failed to fetch cover for ${track.id}: ${toErrorMessage(error)}`)
      }
    }

    updateTrackImportedMetadata(track.id, {
      coverStorageBackend: storedCover?.cover.backend ?? null,
      coverStorageKey: storedCover?.cover.key ?? null,
      coverContentType: storedCover?.cover.contentType ?? null,
      coverThumbStorageBackend: storedCover?.thumb.backend ?? null,
      coverThumbStorageKey: storedCover?.thumb.key ?? null,
      coverThumbContentType: storedCover?.thumb.contentType ?? null,
      coverThumbhash: storedCover?.thumbhash ?? null,
      lyrics: songInfo.lyric,
      title: songInfo.song_name,
      artists: songInfo.singers,
      album: songInfo.album,
      source: songInfo.source,
      sourceIdentifier: toSourceIdentifier(songInfo.identifier),
      durationText: track.durationText ?? (track.durationSeconds ? songInfo.duration : null),
      durationSeconds: typeof track.durationSeconds === 'number' && track.durationSeconds > 0
        ? track.durationSeconds
        : (typeof songInfo.duration_s === 'number' && songInfo.duration_s > 0 ? songInfo.duration_s : null),
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
    initRuntimeDb()
    await main()
  }
  catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

void run()
