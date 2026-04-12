import type { MusicDlConfig } from './config.js'
import path from 'node:path'
import { createClient, type OpenedTrackStream, type Track } from '@jannchie/mdl-sdk'

const musicClient = createClient()

export const musicDlSources = [
  'NeteaseMusicClient',
  'QQMusicClient',
  'KuwoMusicClient',
  'MiguMusicClient',
  'QianqianMusicClient',
  'JamendoMusicClient',
] as const

const aggregateMusicDlSources = [
  'MiguMusicClient',
  'NeteaseMusicClient',
  'QQMusicClient',
  'KuwoMusicClient',
] as const

export type MusicDlSource = (typeof musicDlSources)[number]

export interface MusicDlSongInfo {
  source: string | null
  root_source: string | null
  song_name: string | null
  singers: string | null
  album: string | null
  ext: string | null
  file_size_bytes: number | null
  file_size: string | null
  duration_s: number | null
  duration: string | null
  lyric: string | null
  cover_url: string | null
  download_url: unknown
  download_url_status: unknown
  default_download_headers: Record<string, string>
  downloaded_contents: unknown
  chunk_size: number | null
  protocol: string | null
  identifier: string | number | null
}

export interface MusicDlSearchItem {
  songInfo: MusicDlSongInfo
  display: {
    songName: string | null
    singers: string | null
    album: string | null
    source: string | null
    ext: string | null
    fileSize: string | null
    duration: string | null
    coverUrl: string | null
    downloadable: boolean
  }
}

export interface MusicDlOpenedTrack {
  filename: string
  contentType: string | null
  contentLength: number | null
  body: ReadableStream<Uint8Array>
}

export class MusicDlUnavailableError extends Error {}

export class MusicDlBridgeError extends Error {}

const defaultConfig = {
  searchTimeoutMs: 30_000,
  downloadTimeoutMs: 180_000,
} satisfies Required<MusicDlConfig>

function resolveConfig(config: MusicDlConfig = {}): Required<MusicDlConfig> {
  return {
    searchTimeoutMs: config.searchTimeoutMs ?? defaultConfig.searchTimeoutMs,
    downloadTimeoutMs: config.downloadTimeoutMs ?? defaultConfig.downloadTimeoutMs,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!(timeoutMs > 0)) {
    return promise
  }

  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new MusicDlBridgeError(message)), timeoutMs)
      }),
    ])
  }
  finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

function ensureSourceAvailable(source: string): void {
  if (!musicClient.listSources().includes(source)) {
    throw new MusicDlUnavailableError(`musicdl source is unavailable: ${source}`)
  }
}

function toBridgeError(error: unknown): MusicDlBridgeError | MusicDlUnavailableError {
  if (error instanceof MusicDlUnavailableError || error instanceof MusicDlBridgeError) {
    return error
  }
  if (error instanceof Error) {
    return new MusicDlBridgeError(error.message)
  }
  return new MusicDlBridgeError('Unknown musicdl error')
}

function toMusicDlSongInfo(track: Track): MusicDlSongInfo {
  return {
    source: track.source ?? null,
    root_source: track.rootSource ?? null,
    song_name: track.songName ?? null,
    singers: track.singers ?? null,
    album: track.album ?? null,
    ext: track.ext ?? null,
    file_size_bytes: track.fileSizeBytes ?? null,
    file_size: track.fileSize ?? null,
    duration_s: track.durationS ?? null,
    duration: track.duration ?? null,
    lyric: track.lyric ?? null,
    cover_url: track.coverUrl ?? null,
    download_url: track.downloadUrl ?? null,
    download_url_status: null,
    default_download_headers: track.downloadHeaders ?? {},
    downloaded_contents: null,
    chunk_size: null,
    protocol: track.protocol ?? null,
    identifier: track.identifier ?? null,
  }
}

function toMusicDlSearchItem(track: Track): MusicDlSearchItem {
  return {
    songInfo: toMusicDlSongInfo(track),
    display: {
      songName: track.songName ?? null,
      singers: track.singers ?? null,
      album: track.album ?? null,
      source: track.source ?? null,
      ext: track.ext ?? null,
      fileSize: track.fileSize ?? null,
      duration: track.duration ?? null,
      coverUrl: track.coverUrl ?? null,
      downloadable: Boolean(track.downloadUrl),
    },
  }
}

function toSdkTrack(songInfo: MusicDlSongInfo): Track {
  const identifier = songInfo.identifier === null || songInfo.identifier === undefined
    ? ''
    : String(songInfo.identifier)
  if (!songInfo.source || !identifier) {
    throw new MusicDlBridgeError('Import result is missing source information.')
  }

  const track: Track = {
    source: songInfo.source,
    identifier,
    songName: songInfo.song_name || 'Imported Track',
  }

  if (songInfo.root_source) {
    track.rootSource = songInfo.root_source
  }
  if (songInfo.singers) {
    track.singers = songInfo.singers
  }
  if (songInfo.album) {
    track.album = songInfo.album
  }
  if (songInfo.ext) {
    track.ext = songInfo.ext
  }
  if (typeof songInfo.file_size_bytes === 'number') {
    track.fileSizeBytes = songInfo.file_size_bytes
  }
  if (songInfo.file_size) {
    track.fileSize = songInfo.file_size
  }
  if (typeof songInfo.duration_s === 'number') {
    track.durationS = songInfo.duration_s
  }
  if (songInfo.duration) {
    track.duration = songInfo.duration
  }
  if (songInfo.lyric) {
    track.lyric = songInfo.lyric
  }
  if (songInfo.cover_url) {
    track.coverUrl = songInfo.cover_url
  }
  if (typeof songInfo.download_url === 'string' && songInfo.download_url) {
    track.downloadUrl = songInfo.download_url
  }
  if (songInfo.protocol === 'http' || songInfo.protocol === 'hls') {
    track.protocol = songInfo.protocol
  }
  const downloadHeaders = songInfo.default_download_headers ?? {}
  if (Object.keys(downloadHeaders).length > 0) {
    track.downloadHeaders = downloadHeaders
  }

  return track
}

async function searchSingleSource(keyword: string, source: MusicDlSource, config: Required<MusicDlConfig>): Promise<MusicDlSearchItem[]> {
  try {
    ensureSourceAvailable(source)

    const result = await withTimeout(
      musicClient.search({
        keyword,
        sources: [source],
        searchSizePerSource: 5,
        searchSizePerPage: 10,
        requestOverrides: {
          [source]: {
            timeoutMs: config.searchTimeoutMs,
          },
        },
      }),
      config.searchTimeoutMs,
      'musicdl request timed out',
    )

    return (result[source] ?? [])
      .filter(track => !(track.episodes && track.episodes.length > 0))
      .map(toMusicDlSearchItem)
  }
  catch (error) {
    throw toBridgeError(error)
  }
}

function guessContentType(extOrFilename: string): string | null {
  const ext = extOrFilename.startsWith('.') ? extOrFilename.toLowerCase() : path.extname(extOrFilename).toLowerCase()
  if (ext === '.mp3') {
    return 'audio/mpeg'
  }
  if (ext === '.wav') {
    return 'audio/wav'
  }
  if (ext === '.flac') {
    return 'audio/flac'
  }
  if (ext === '.ogg') {
    return 'audio/ogg'
  }
  if (ext === '.aac') {
    return 'audio/aac'
  }
  if (ext === '.m4a') {
    return 'audio/mp4'
  }
  if (ext === '.opus') {
    return 'audio/ogg'
  }
  return null
}

function sanitizeFilenamePart(value: string): string {
  return value.replaceAll(/[\\/:*?"<>|]/g, ' ').replaceAll(/\s+/g, ' ').trim()
}

function normalizeExtension(value: string | null | undefined): string {
  if (!value) {
    return ''
  }
  return value.startsWith('.') ? value : `.${value}`
}

function buildImportedFilename(songInfo: MusicDlSongInfo, extensionHint?: string | null): string {
  const ext = normalizeExtension(extensionHint ?? songInfo.ext)
  const songName = sanitizeFilenamePart(songInfo.song_name || 'Imported Track')
  const singers = sanitizeFilenamePart(songInfo.singers || '')
  const baseName = singers ? `${songName} - ${singers}` : songName
  return `${baseName}${ext}`
}

export async function searchMusicDl(keyword: string, source: MusicDlSource | undefined, config: MusicDlConfig = {}): Promise<MusicDlSearchItem[]> {
  const resolvedConfig = resolveConfig(config)
  let results: MusicDlSearchItem[]

  if (source) {
    results = await searchSingleSource(keyword, source, resolvedConfig)
  }
  else {
    const settledResults = await Promise.allSettled(
      aggregateMusicDlSources.map(async currentSource => ({
        source: currentSource,
        items: await searchSingleSource(keyword, currentSource, {
          ...resolvedConfig,
          searchTimeoutMs: Math.min(resolvedConfig.searchTimeoutMs, 20_000),
        }),
      })),
    )

    results = settledResults.flatMap((result) => {
      if (result.status !== 'fulfilled') {
        return []
      }
      return result.value.items
    })
  }

  if (results.length === 0) {
    throw new MusicDlBridgeError('All sources timed out or returned no results')
  }

  return results.toSorted((left, right) => {
    if (left.display.downloadable !== right.display.downloadable) {
      return left.display.downloadable ? -1 : 1
    }
    return 0
  })
}

function toOpenedTrack(songInfo: MusicDlSongInfo, stream: OpenedTrackStream): MusicDlOpenedTrack {
  return {
    filename: buildImportedFilename(songInfo, stream.ext),
    contentType: stream.contentType ?? guessContentType(stream.ext ?? songInfo.ext ?? ''),
    contentLength: stream.contentLength,
    body: stream.body,
  }
}

export async function openMusicDlStream(songInfo: MusicDlSongInfo, config: MusicDlConfig = {}): Promise<MusicDlOpenedTrack> {
  const resolvedConfig = resolveConfig(config)
  if (!songInfo.source) {
    throw new MusicDlBridgeError('Import result is missing source information.')
  }

  try {
    ensureSourceAvailable(songInfo.source)

    const response = await withTimeout(
      musicClient.openTrackStream({
        track: toSdkTrack(songInfo),
      }),
      resolvedConfig.downloadTimeoutMs,
      'musicdl request timed out',
    )
    return toOpenedTrack(songInfo, response)
  }
  catch (error) {
    throw toBridgeError(error)
  }
}
