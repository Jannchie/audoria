import type { OpenedTrackStream, TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-sdk'
import type { MusicDlConfig } from './config.js'
import path from 'node:path'
import { createClient } from '@jannchie/mdl-sdk'

const musicClient = createClient()

export const musicDlSources = [
  'NeteaseMusicClient',
  'QQMusicClient',
  'KuwoMusicClient',
  'MiguMusicClient',
  'JamendoMusicClient',
] as const

const aggregateMusicDlSources = musicDlSources

const defaultSearchSizePerSource = 10
// Use a small page size so paginated sources fetch results with multiple upstream requests.
const searchSizePerPage = 2

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
  raw_data: Record<string, unknown> | null
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

function normalizeMatchText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/\(.*?\)|（.*?）/g, '')
    .replaceAll(/[^a-z0-9\u4E00-\u9FFF]+/g, '')
}

function toMusicDlSongInfo(track: TrackSummary | TrackDetail): MusicDlSongInfo {
  return {
    source: track.source ?? null,
    root_source: track.rootSource ?? null,
    song_name: track.songName ?? null,
    singers: track.singers ?? null,
    album: track.album ?? null,
    ext: 'ext' in track ? track.ext ?? null : null,
    file_size_bytes: 'fileSizeBytes' in track ? track.fileSizeBytes ?? null : null,
    file_size: 'fileSize' in track ? track.fileSize ?? null : null,
    duration_s: track.durationS ?? null,
    duration: track.duration ?? null,
    lyric: 'lyric' in track ? track.lyric ?? null : null,
    cover_url: track.coverUrl ?? null,
    download_url: track.downloadUrl ?? null,
    download_url_status: null,
    default_download_headers: 'downloadHeaders' in track ? track.downloadHeaders ?? {} : {},
    downloaded_contents: null,
    chunk_size: null,
    protocol: 'protocol' in track ? track.protocol ?? null : null,
    identifier: track.identifier ?? null,
    raw_data: track.rawData ?? null,
  }
}

function toMusicDlSearchItem(track: TrackSummary | TrackDetail): MusicDlSearchItem {
  const ext = 'ext' in track ? track.ext ?? null : null
  const fileSize = 'fileSize' in track ? track.fileSize ?? null : null
  const downloadable = Boolean(track.source && track.identifier)

  return {
    songInfo: toMusicDlSongInfo(track),
    display: {
      songName: track.songName ?? null,
      singers: track.singers ?? null,
      album: track.album ?? null,
      source: track.source ?? null,
      ext,
      fileSize,
      duration: track.duration ?? null,
      coverUrl: track.coverUrl ?? null,
      downloadable,
    },
  }
}

function toTrackLookup(songInfo: MusicDlSongInfo): TrackLookup {
  const identifier = songInfo.identifier === null || songInfo.identifier === undefined
    ? ''
    : String(songInfo.identifier)
  if (!songInfo.source || !identifier) {
    throw new MusicDlBridgeError('Import result is missing source information.')
  }

  const track: TrackLookup = {
    source: songInfo.source,
    identifier,
  }

  if (songInfo.root_source) {
    track.rootSource = songInfo.root_source
  }
  if (songInfo.song_name) {
    track.songName = songInfo.song_name
  }
  if (songInfo.singers) {
    track.singers = songInfo.singers
  }
  if (songInfo.album) {
    track.album = songInfo.album
  }
  if (typeof songInfo.duration_s === 'number') {
    track.durationS = songInfo.duration_s
  }
  if (songInfo.cover_url) {
    track.coverUrl = songInfo.cover_url
  }
  if (typeof songInfo.download_url === 'string' && songInfo.download_url) {
    track.downloadUrl = songInfo.download_url
  }
  if (songInfo.raw_data && typeof songInfo.raw_data === 'object') {
    track.rawData = songInfo.raw_data
  }

  return track
}

function toSdkTrack(songInfo: MusicDlSongInfo): TrackDetail {
  const downloadUrl = typeof songInfo.download_url === 'string' ? songInfo.download_url : ''
  if (!downloadUrl) {
    throw new MusicDlBridgeError('Import result is missing a downloadable audio URL.')
  }

  const track: TrackDetail = {
    ...toTrackLookup(songInfo),
    songName: songInfo.song_name || 'Imported Track',
    downloadUrl,
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

function buildRequestOptions(source: string, timeoutMs: number) {
  return {
    requestOptions: {
      [source]: {
        timeoutMs,
      },
    },
  }
}

async function fetchTrackDetail(track: TrackLookup, config: Required<MusicDlConfig>): Promise<TrackDetail> {
  return await withTimeout(
    musicClient.fetchDetail(
      track,
      buildRequestOptions(track.source, config.searchTimeoutMs),
    ),
    config.searchTimeoutMs,
    'musicdl request timed out',
  )
}

async function searchSourceTracks(
  keyword: string,
  source: MusicDlSource,
  config: Required<MusicDlConfig>,
  limitPerSource: number,
): Promise<TrackSummary[]> {
  const result = await withTimeout(
    musicClient.search(
      keyword,
      {
        sources: [source],
        limit: limitPerSource,
        pageSize: searchSizePerPage,
        ...buildRequestOptions(source, config.searchTimeoutMs),
      },
    ),
    config.searchTimeoutMs,
    'musicdl request timed out',
  )

  return (result[source] ?? [])
    .filter(track => !('episodes' in track && Array.isArray(track.episodes) && track.episodes.length > 0))
}

function buildQqFallbackKeywords(songInfo: MusicDlSongInfo): string[] {
  const songName = songInfo.song_name?.trim() ?? ''
  const singers = songInfo.singers?.trim() ?? ''
  const firstSinger = singers
    .split(',')
    .map(name => name.trim())
    .find(Boolean) ?? ''

  return [...new Set([
    [songName, singers].filter(Boolean).join(' ').trim(),
    [songName, firstSinger].filter(Boolean).join(' ').trim(),
    songName,
  ].filter(Boolean))]
}

function pickBestQqTrackMatch(songInfo: MusicDlSongInfo, tracks: TrackSummary[]): TrackSummary | null {
  const identifier = songInfo.identifier === null || songInfo.identifier === undefined
    ? ''
    : String(songInfo.identifier)
  const exactIdentifierMatch = tracks.find(track => track.identifier === identifier)
  if (exactIdentifierMatch) {
    return exactIdentifierMatch
  }

  const normalizedSongName = normalizeMatchText(songInfo.song_name)
  const normalizedSingers = normalizeMatchText(songInfo.singers)
  const exactMetadataMatch = tracks.find((track) => {
    return normalizeMatchText(track.songName) === normalizedSongName
      && normalizeMatchText(track.singers) === normalizedSingers
  })
  if (exactMetadataMatch) {
    return exactMetadataMatch
  }

  const titleMatch = tracks.find(track => normalizeMatchText(track.songName) === normalizedSongName)
  if (titleMatch) {
    return titleMatch
  }

  return tracks[0] ?? null
}

async function fetchQqTrackDetailFallback(songInfo: MusicDlSongInfo, config: Required<MusicDlConfig>): Promise<TrackDetail | null> {
  for (const keyword of buildQqFallbackKeywords(songInfo)) {
    const tracks = await searchSourceTracks(keyword, 'QQMusicClient', config, defaultSearchSizePerSource)
    const matchedTrack = pickBestQqTrackMatch(songInfo, tracks)
    if (!matchedTrack) {
      continue
    }

    try {
      return await fetchTrackDetail(matchedTrack, config)
    }
    catch {
      continue
    }
  }

  return null
}

async function searchSingleSource(
  keyword: string,
  source: MusicDlSource,
  config: Required<MusicDlConfig>,
  limitPerSource: number,
): Promise<MusicDlSearchItem[]> {
  try {
    ensureSourceAvailable(source)
    return (await searchSourceTracks(keyword, source, config, limitPerSource))
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

export async function searchMusicDl(
  keyword: string,
  source: MusicDlSource | undefined,
  config: MusicDlConfig = {},
  limitPerSource = defaultSearchSizePerSource,
): Promise<MusicDlSearchItem[]> {
  const resolvedConfig = resolveConfig(config)
  let results: MusicDlSearchItem[]
  const normalizedLimitPerSource = Math.max(1, Math.floor(limitPerSource))

  if (source) {
    results = await searchSingleSource(keyword, source, resolvedConfig, normalizedLimitPerSource)
  }
  else {
    const settledResults = await Promise.allSettled(
      aggregateMusicDlSources.map(async currentSource => ({
        source: currentSource,
        items: await searchSingleSource(keyword, currentSource, {
          ...resolvedConfig,
          searchTimeoutMs: Math.min(resolvedConfig.searchTimeoutMs, 20_000),
        }, normalizedLimitPerSource),
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

export async function resolveMusicDlSongInfo(songInfo: MusicDlSongInfo, config: MusicDlConfig = {}): Promise<MusicDlSongInfo> {
  const resolvedConfig = resolveConfig(config)
  const trackLookup = toTrackLookup(songInfo)

  try {
    ensureSourceAvailable(trackLookup.source)

    let trackDetail: TrackDetail
    try {
      trackDetail = await fetchTrackDetail(trackLookup, resolvedConfig)
    }
    catch (error) {
      if (trackLookup.source !== 'QQMusicClient') {
        throw error
      }

      const fallbackDetail = await fetchQqTrackDetailFallback(songInfo, resolvedConfig)
      if (!fallbackDetail) {
        throw error
      }
      trackDetail = fallbackDetail
    }
    if (!trackDetail.downloadUrl) {
      throw new MusicDlBridgeError('This track is not downloadable.')
    }
    return toMusicDlSongInfo(trackDetail)
  }
  catch (error) {
    throw toBridgeError(error)
  }
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
      musicClient.openTrackStream(
        toSdkTrack(songInfo),
        buildRequestOptions(songInfo.source, resolvedConfig.downloadTimeoutMs),
      ),
      resolvedConfig.downloadTimeoutMs,
      'musicdl request timed out',
    )
    return toOpenedTrack(songInfo, response)
  }
  catch (error) {
    throw toBridgeError(error)
  }
}
