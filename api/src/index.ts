import type { ApiReferenceConfiguration } from '@scalar/hono-api-reference'
import type { ReadableStream } from 'node:stream/web'
import type { ConfigOverrides } from './configOverrides.js'
import type { MusicImportJob, MusicImportJobStatus, Playlist, PlaylistSummary, Track } from './db.js'
import { env } from 'node:process'
import { Readable } from 'node:stream'
import { serve } from '@hono/node-server'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { desc, eq } from 'drizzle-orm'
import { cors } from 'hono/cors'
import { aiProviderApiKeyEnvNames, config, loadConfig, mergeConfigSources, pickSecretConfigSource, readPersistedConfigSource } from './config.js'
import { applyConfigOverrides, writePersistedConfigOverrides } from './configOverrides.js'
import {
  addTrackToPlaylist,
  createMusicImportJobFromCandidate,
  createPlaylist,
  db,
  deletePlaylist,
  getMusicImportCandidateById,
  getMusicImportJobById,
  getPlaylistById,
  getPlaylistIdsForTracks,
  getPlaylistTrackIds,
  getPlaylistTracks,
  getTrackById,
  insertMusicImportCandidates,
  listAllTrackPlaylistPairs,
  listPlaylists,
  pruneExpiredMusicImportCandidates,
  removeTrackFromAllPlaylists,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  tracks,
  updatePlaylist,
  updateTrackCover,
  updateTrackEditableMetadata,
} from './db.js'
import { MusicDlBridgeError, MusicDlUnavailableError, resolveMusicDlSongInfo, resolveMusicUrl, searchMusicDl } from './musicdl.js'
import { musicDlSources, musicDlUrlSources } from './musicSources.js'
import {
  deleteStoredTrack,
  deleteTrackCover,
  getStoredTrack,
  getStoredTrackCover,
  isStorageObjectMissingError,
  readStoredTrackCoverMaskBuffer,
  storeTrack,
  storeTrackCover,
} from './storage.js'

function buildCoverPath(id: string, variant: 'cover' | 'thumb' = 'cover'): string {
  if (variant === 'thumb') {
    return `/music/${id}/cover/thumb`
  }
  return `/music/${id}/cover`
}

function toMusicResponse(row: Track, playlistIds: string[] = []) {
  return {
    id: row.id,
    filename: row.filename,
    size: row.size,
    contentType: row.contentType,
    coverUrl: row.coverStorageKey ? buildCoverPath(row.id, 'cover') : null,
    coverThumbUrl: row.coverStorageKey ? buildCoverPath(row.id, 'thumb') : null,
    coverThumbhash: row.coverThumbhash,
    lyrics: row.lyrics,
    title: row.title,
    artists: row.artists,
    album: row.album,
    source: row.source,
    sourceIdentifier: row.sourceIdentifier,
    durationText: row.durationText,
    durationSeconds: row.durationSeconds,
    playlistIds,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

function toMusicImportJobResponse(job: MusicImportJob) {
  return {
    id: job.id,
    source: job.source,
    songName: job.songName,
    singers: job.singers,
    status: job.status as MusicImportJobStatus,
    trackId: job.trackId,
    errorMessage: job.errorMessage,
    progressBytes: job.progressBytes,
    totalBytes: job.totalBytes,
    progressPercent: job.progressPercent,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
  }
}

function toPlaylistSummaryResponse(playlist: PlaylistSummary) {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    trackCount: playlist.trackCount,
    totalDurationSeconds: playlist.totalDurationSeconds,
    previewCoverUrls: playlist.previewTrackIds.map(id => buildCoverPath(id, 'thumb')),
    previewCoverThumbhashes: playlist.previewCoverThumbhashes,
    createdAt: new Date(playlist.createdAt).toISOString(),
    updatedAt: new Date(playlist.updatedAt).toISOString(),
  }
}

function toPlaylistDetailResponse(playlist: Playlist, playlistTracks: Track[]) {
  const totalDurationSeconds = playlistTracks.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0)
  const previewCoverTracks = playlistTracks
    .filter(track => track.coverThumbStorageKey || track.coverStorageKey)
    .slice(0, 4)
  const previewCoverUrls = previewCoverTracks.map(track => buildCoverPath(track.id, 'thumb'))
  const trackIdToPlaylistIds = getPlaylistIdsForTracks(playlistTracks.map(track => track.id))

  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    trackCount: playlistTracks.length,
    totalDurationSeconds,
    previewCoverUrls,
    previewCoverThumbhashes: previewCoverTracks.map(track => track.coverThumbhash),
    createdAt: new Date(playlist.createdAt).toISOString(),
    updatedAt: new Date(playlist.updatedAt).toISOString(),
    tracks: playlistTracks.map(track => toMusicResponse(track, trackIdToPlaylistIds.get(track.id) ?? [])),
  }
}

const MusicSchema = z.object({
  id: z.string().openapi({ example: 'a3f9d3d1-9c9d-4a40-a54d-0e4cb7acb8a0' }),
  filename: z.string().openapi({ example: 'track.mp3' }),
  size: z.number().int().nonnegative().openapi({ example: 1_280_000 }),
  contentType: z.string().nullable().openapi({ example: 'audio/mpeg' }),
  coverUrl: z.string().nullable().openapi({ example: '/music/a3f9d3d1-9c9d-4a40-a54d-0e4cb7acb8a0/cover' }),
  coverThumbUrl: z.string().nullable().openapi({ example: '/music/a3f9d3d1-9c9d-4a40-a54d-0e4cb7acb8a0/cover/thumb' }),
  coverThumbhash: z.string().nullable().openapi({ example: '2OcRJYB4d3h/iIeHeEh3eIhw+j2A=' }),
  lyrics: z.string().nullable().openapi({ example: '[00:00.00] Lyrics line' }),
  title: z.string().nullable().openapi({ example: '稻香' }),
  artists: z.string().nullable().openapi({ example: '周杰伦' }),
  album: z.string().nullable().openapi({ example: '魔杰座' }),
  source: z.string().nullable().openapi({ example: 'NeteaseMusicClient' }),
  sourceIdentifier: z.string().nullable().openapi({ example: '1901371647' }),
  durationText: z.string().nullable().openapi({ example: '00:03:43' }),
  durationSeconds: z.number().int().nullable().openapi({ example: 223 }),
  playlistIds: z.array(z.string()).openapi({
    example: ['3d4fe5c7-280f-4b32-bf8d-7571466ae1a3'],
    description: 'Ids of playlists this track is part of',
  }),
  createdAt: z.string().datetime().openapi({ example: '2024-01-01T12:00:00.000Z' }),
}).openapi('Music')

const ErrorSchema = z.object({
  message: z.string(),
})

const PlaylistSchema = z.object({
  id: z.string().openapi({ example: '3d4fe5c7-280f-4b32-bf8d-7571466ae1a3' }),
  name: z.string().openapi({ example: 'Favorites' }),
  description: z.string().nullable().openapi({ example: 'Tracks for focused listening' }),
  trackCount: z.number().int().nonnegative().openapi({ example: 12 }),
  totalDurationSeconds: z.number().int().nonnegative().openapi({ example: 2765 }),
  previewCoverUrls: z.array(z.string()).max(4).openapi({
    example: ['/music/a3f9d3d1-9c9d-4a40-a54d-0e4cb7acb8a0/cover/thumb'],
  }),
  previewCoverThumbhashes: z.array(z.string().nullable()).max(4).openapi({
    example: ['2OcRJYB4d3h/iIeHeEh3eIhw+j2A='],
  }),
  createdAt: z.string().datetime().openapi({ example: '2024-01-01T12:00:00.000Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2024-01-02T08:30:00.000Z' }),
}).openapi('Playlist')

const PlaylistDetailSchema = PlaylistSchema.extend({
  tracks: z.array(MusicSchema),
}).openapi('PlaylistDetail')

const PlaylistInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
}).openapi('PlaylistInput')

const PlaylistTrackInputSchema = z.object({
  trackId: z.string().min(1),
}).openapi('PlaylistTrackInput')

const PlaylistReorderRequestSchema = z.object({
  trackIds: z.array(z.string().min(1)).max(10_000),
}).openapi('PlaylistReorderRequest')

const MusicDlSourceSchema = z.enum(musicDlSources).openapi('MusicDlSource')
const MusicDlUrlSourceSchema = z.enum(musicDlUrlSources).openapi('MusicDlUrlSource')

const MusicDlSearchRequestSchema = z.object({
  keyword: z.string().trim().min(1).max(120),
  source: MusicDlSourceSchema.optional(),
  limitPerSource: z.number().int().min(1).max(50).optional(),
}).openapi('MusicDlSearchRequest')

const MusicDlSearchResultSchema = z.object({
  id: z.string().openapi({ example: '1db3c804-2b09-4d56-8a52-9a0276d46457' }),
  songName: z.string().openapi({ example: '稻香' }),
  singers: z.string().openapi({ example: '周杰伦' }),
  album: z.string().openapi({ example: '魔杰座' }),
  source: z.string().openapi({ example: 'NeteaseMusicClient' }),
  sourceIdentifier: z.string().nullable().openapi({ example: '1901371647' }),
  ext: z.string().openapi({ example: 'mp3' }),
  fileSize: z.string().openapi({ example: '10.23MB' }),
  duration: z.string().openapi({ example: '00:03:43' }),
  coverUrl: z.string().nullable().openapi({ example: 'https://example.com/cover.jpg' }),
  downloadable: z.boolean().openapi({ example: true }),
}).openapi('MusicDlSearchResult')

const MusicImportJobSchema = z.object({
  id: z.string().openapi({ example: 'a707f0a9-5e31-49cc-8c6a-fc52f770f5c2' }),
  source: z.string().openapi({ example: 'NeteaseMusicClient' }),
  songName: z.string().openapi({ example: '稻香' }),
  singers: z.string().openapi({ example: '周杰伦' }),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']).openapi({ example: 'queued' }),
  trackId: z.string().nullable().openapi({ example: 'c83a85b7-8d29-4fef-b4b2-15a420595b6b' }),
  errorMessage: z.string().nullable().openapi({ example: 'musicdl request timed out' }),
  progressBytes: z.number().int().nullable().openapi({ example: 5_242_880 }),
  totalBytes: z.number().int().nullable().openapi({ example: 10_485_760 }),
  progressPercent: z.number().int().min(0).max(100).nullable().openapi({ example: 50 }),
  createdAt: z.string().datetime().openapi({ example: '2024-01-01T12:00:00.000Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2024-01-01T12:00:01.000Z' }),
  startedAt: z.string().datetime().nullable().openapi({ example: '2024-01-01T12:00:01.000Z' }),
  finishedAt: z.string().datetime().nullable().openapi({ example: '2024-01-01T12:00:12.000Z' }),
}).openapi('MusicImportJob')

const MusicDlImportRequestSchema = z.object({
  resultId: z.string().min(1),
}).openapi('MusicDlImportRequest')

const UpdateMusicRequestSchema = z.object({
  title: z.string().max(512).nullable().optional(),
  artists: z.string().max(512).nullable().optional(),
  album: z.string().max(512).nullable().optional(),
  source: z.string().max(128).nullable().optional(),
  lyrics: z.string().max(200_000).nullable().optional(),
}).openapi('UpdateMusicRequest')

const MusicDlParseUrlRequestSchema = z.object({
  url: z.string().trim().min(1).max(512),
}).openapi('MusicDlParseUrlRequest')

const AppConfigSchema = z.object({
  api: z.object({
    port: z.number().int().openapi({ example: 8787 }),
  }),
  metadata: z.object({
    backend: z.literal('sqlite').openapi({ example: 'sqlite' }),
    dbPath: z.string().openapi({ example: './api/data/audoria.sqlite' }),
  }),
  storage: z.discriminatedUnion('backend', [
    z.object({
      backend: z.literal('fs'),
      rootDir: z.string().openapi({ example: './api/data/storage' }),
    }),
    z.object({
      backend: z.literal('s3'),
      bucket: z.string().openapi({ example: 'audoria' }),
      endpoint: z.string().nullable().openapi({ example: 'http://127.0.0.1:9000' }),
      region: z.string().openapi({ example: 'us-east-1' }),
      forcePathStyle: z.boolean().openapi({ example: true }),
      accessKeyConfigured: z.boolean().openapi({ example: true }),
      secretKeyConfigured: z.boolean().openapi({ example: true }),
    }),
  ]),
  ai: z.object({
    providers: z.object({
      openai: z.object({
        apiKeyEnvName: z.string().openapi({ example: 'OPENAI_API_KEY' }),
        apiKeyConfigured: z.boolean().openapi({ example: true }),
        apiKeySource: z.enum(['environment', 'settings']).nullable().openapi({ example: 'settings' }),
      }),
    }),
  }),
  musicdl: z.object({
    sources: z.array(MusicDlSourceSchema).openapi({ example: ['NeteaseMusicClient', 'QQMusicClient'] }),
    urlSources: z.array(MusicDlUrlSourceSchema).openapi({ example: ['Bilibili', 'Youtube'] }),
    searchTimeoutMs: z.number().int().openapi({ example: 30_000 }),
    downloadTimeoutMs: z.number().int().openapi({ example: 180_000 }),
  }),
  imports: z.object({
    candidateTtlMs: z.number().int().openapi({ example: 1_800_000 }),
    workerPollMs: z.number().int().openapi({ example: 3000 }),
  }),
}).openapi('AppConfig')

const AppConfigUpdateSchema = z.object({
  metadata: z.object({
    dbPath: z.string().trim().min(1).optional(),
  }).optional(),
  storage: z.discriminatedUnion('backend', [
    z.object({
      backend: z.literal('fs'),
      rootDir: z.string().trim().min(1),
    }),
    z.object({
      backend: z.literal('s3'),
      bucket: z.string().trim().min(1),
      endpoint: z.string().trim().nullable().optional(),
      region: z.string().trim().min(1),
      forcePathStyle: z.boolean(),
      accessKeyId: z.string().optional(),
      secretAccessKey: z.string().optional(),
    }),
  ]).optional(),
  ai: z.object({
    providers: z.object({
      openai: z.object({
        apiKey: z.string().optional(),
        removeApiKey: z.boolean().optional(),
      }).optional(),
    }).optional(),
  }).optional(),
  musicdl: z.object({
    sources: z.array(MusicDlSourceSchema).min(1).optional(),
    urlSources: z.array(MusicDlUrlSourceSchema).min(1).optional(),
    searchTimeoutMs: z.number().int().min(1).optional(),
    downloadTimeoutMs: z.number().int().min(1).optional(),
  }).optional(),
  imports: z.object({
    candidateTtlMs: z.number().int().min(1).optional(),
    workerPollMs: z.number().int().min(1).optional(),
  }).optional(),
}).openapi('AppConfigUpdate')

const AppConfigUpdateResponseSchema = z.object({
  config: AppConfigSchema,
  restartRequired: z.boolean(),
}).openapi('AppConfigUpdateResponse')

type AppConfigUpdate = z.infer<typeof AppConfigUpdateSchema>

function getConfiguredValueSource(key: string, configured: boolean): 'environment' | 'settings' | null {
  if (!configured) {
    return null
  }
  return env[key]?.trim() ? 'environment' : 'settings'
}

function toAppConfigResponse(appConfig = loadConfig()) {
  const storage = appConfig.storage.backend === 'fs'
    ? {
        backend: 'fs' as const,
        rootDir: appConfig.storage.fs?.rootDir ?? '',
      }
    : {
        backend: 's3' as const,
        bucket: appConfig.storage.s3?.bucket ?? '',
        endpoint: appConfig.storage.s3?.endpoint ?? null,
        region: appConfig.storage.s3?.region ?? '',
        forcePathStyle: appConfig.storage.s3?.forcePathStyle ?? true,
        accessKeyConfigured: Boolean(appConfig.storage.s3?.accessKeyId),
        secretKeyConfigured: Boolean(appConfig.storage.s3?.secretAccessKey),
      }

  const openaiApiKeyConfigured = Boolean(appConfig.ai.providers.openai.apiKey)

  return {
    api: {
      port: appConfig.port,
    },
    metadata: {
      backend: 'sqlite' as const,
      dbPath: appConfig.dbPath,
    },
    storage,
    ai: {
      providers: {
        openai: {
          apiKeyEnvName: appConfig.ai.providers.openai.apiKeyEnvName,
          apiKeyConfigured: openaiApiKeyConfigured,
          apiKeySource: getConfiguredValueSource(aiProviderApiKeyEnvNames.openai, openaiApiKeyConfigured),
        },
      },
    },
    musicdl: {
      sources: [...appConfig.musicdl.sources],
      urlSources: [...appConfig.musicdl.urlSources],
      searchTimeoutMs: appConfig.musicdl.searchTimeoutMs,
      downloadTimeoutMs: appConfig.musicdl.downloadTimeoutMs,
    },
    imports: {
      candidateTtlMs: appConfig.importCandidateTtlMs,
      workerPollMs: appConfig.importWorkerPollMs,
    },
  }
}

function assignOptionalSecret(overrides: ConfigOverrides, key: string, value: string | undefined): void {
  const trimmed = value?.trim()
  if (trimmed) {
    overrides[key] = trimmed
  }
}

function toConfigOverrides(update: AppConfigUpdate): ConfigOverrides {
  const overrides: ConfigOverrides = {}

  if (update.metadata?.dbPath) {
    overrides.DB_PATH = update.metadata.dbPath
  }

  if (update.storage?.backend === 'fs') {
    overrides.STORAGE_BACKEND = 'fs'
    overrides.STORAGE_FS_ROOT = update.storage.rootDir
  }
  if (update.storage?.backend === 's3') {
    overrides.STORAGE_BACKEND = 's3'
    overrides.S3_BUCKET = update.storage.bucket
    overrides.S3_ENDPOINT = update.storage.endpoint?.trim() || null
    overrides.S3_REGION = update.storage.region
    overrides.S3_FORCE_PATH_STYLE = update.storage.forcePathStyle ? 'true' : 'false'
    assignOptionalSecret(overrides, 'S3_ACCESS_KEY_ID', update.storage.accessKeyId)
    assignOptionalSecret(overrides, 'S3_SECRET_ACCESS_KEY', update.storage.secretAccessKey)
  }

  const openaiUpdate = update.ai?.providers?.openai
  if (openaiUpdate?.removeApiKey) {
    overrides[aiProviderApiKeyEnvNames.openai] = null
  }
  else {
    assignOptionalSecret(overrides, aiProviderApiKeyEnvNames.openai, openaiUpdate?.apiKey)
  }

  if (update.musicdl?.sources) {
    overrides.MUSICDL_SOURCES = update.musicdl.sources.join(',')
  }
  if (update.musicdl?.urlSources) {
    overrides.MUSICDL_URL_SOURCES = update.musicdl.urlSources.join(',')
  }
  if (update.musicdl?.searchTimeoutMs) {
    overrides.MUSICDL_SEARCH_TIMEOUT_MS = String(update.musicdl.searchTimeoutMs)
  }
  if (update.musicdl?.downloadTimeoutMs) {
    overrides.MUSICDL_DOWNLOAD_TIMEOUT_MS = String(update.musicdl.downloadTimeoutMs)
  }

  if (update.imports?.candidateTtlMs) {
    overrides.IMPORT_CANDIDATE_TTL_MS = String(update.imports.candidateTtlMs)
  }
  if (update.imports?.workerPollMs) {
    overrides.IMPORT_WORKER_POLL_MS = String(update.imports.workerPollMs)
  }

  return overrides
}

function requiresRestart(overrides: ConfigOverrides): boolean {
  return Object.keys(overrides).some(key =>
    key === 'DB_PATH'
    || key === 'PORT'
    || key.startsWith('STORAGE_')
    || key.startsWith('S3_'),
  )
}

function applyLiveConfig(nextConfig: typeof config): void {
  config.ai = nextConfig.ai
  config.musicdl = nextConfig.musicdl
  config.importCandidateTtlMs = nextConfig.importCandidateTtlMs
  config.importWorkerPollMs = nextConfig.importWorkerPollMs
}

const app = new OpenAPIHono()

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

const uploadMusicRoute = createRoute({
  method: 'post',
  path: '/music',
  summary: 'Upload a music file',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().openapi({
              type: 'string',
              format: 'binary',
              description: 'Audio file to store',
            }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created',
      content: {
        'application/json': {
          schema: MusicSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(uploadMusicRoute, async (c) => {
  const formData = await c.req.formData()
  const filePart = formData.get('file')

  if (!(filePart instanceof File)) {
    return c.json({ message: 'File part is required' }, 400)
  }

  const record = await storeTrack({
    filename: filePart.name || 'audio',
    contentType: filePart.type || null,
    size: Number(filePart.size),
    body: Readable.fromWeb(filePart.stream() as unknown as ReadableStream),
  })

  return c.json(toMusicResponse(record), 201)
})

const searchImportRoute = createRoute({
  method: 'post',
  path: '/music/imports/search',
  summary: 'Search tracks through musicdl',
  request: {
    body: {
      content: {
        'application/json': {
          schema: MusicDlSearchRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Search results',
      content: {
        'application/json': {
          schema: z.array(MusicDlSearchResultSchema),
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    502: {
      description: 'musicdl failed',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    503: {
      description: 'musicdl unavailable',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(searchImportRoute, async (c) => {
  try {
    pruneExpiredMusicImportCandidates()
    const { keyword, source, limitPerSource } = c.req.valid('json')
    const results = await searchMusicDl(keyword, source, config.musicdl, limitPerSource)

    const candidateRecords = insertMusicImportCandidates(results.map(item => ({
      source: item.display.source || source || 'UnknownSource',
      songName: item.display.songName || 'Unknown Track',
      singers: item.display.singers || 'Unknown Artist',
      album: item.display.album || 'Unknown Album',
      ext: item.display.ext || 'audio',
      fileSize: item.display.fileSize || '-',
      duration: item.display.duration || '-',
      coverUrl: item.display.coverUrl,
      downloadable: item.display.downloadable ? 1 : 0,
      songInfoJson: JSON.stringify(item.songInfo),
    })))

    return c.json(candidateRecords.map(record => ({
      id: record.id,
      songName: record.songName,
      singers: record.singers,
      album: record.album,
      source: record.source,
      sourceIdentifier: toSourceIdentifier(JSON.parse(record.songInfoJson).identifier),
      ext: record.ext,
      fileSize: record.fileSize,
      duration: record.duration,
      coverUrl: record.coverUrl,
      downloadable: Boolean(record.downloadable),
    })), 200)
  }
  catch (error) {
    if (error instanceof MusicDlUnavailableError) {
      return c.json({ message: error.message }, 503)
    }
    if (error instanceof MusicDlBridgeError) {
      return c.json({ message: error.message }, 502)
    }
    throw error
  }
})

const parseUrlImportRoute = createRoute({
  method: 'post',
  path: '/music/imports/parse-url',
  summary: 'Resolve a Bilibili or Youtube URL into an importable candidate',
  request: {
    body: {
      content: {
        'application/json': {
          schema: MusicDlParseUrlRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Parsed result',
      content: {
        'application/json': {
          schema: MusicDlSearchResultSchema,
        },
      },
    },
    400: {
      description: 'Invalid URL',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    502: {
      description: 'musicdl failed',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    503: {
      description: 'musicdl unavailable',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(parseUrlImportRoute, async (c) => {
  try {
    pruneExpiredMusicImportCandidates()
    const { url } = c.req.valid('json')
    const item = await resolveMusicUrl(url, config.musicdl)

    const [record] = insertMusicImportCandidates([{
      source: item.display.source || 'UnknownSource',
      songName: item.display.songName || 'Unknown Track',
      singers: item.display.singers || 'Unknown Artist',
      album: item.display.album || 'Unknown Album',
      ext: item.display.ext || 'audio',
      fileSize: item.display.fileSize || '-',
      duration: item.display.duration || '-',
      coverUrl: item.display.coverUrl,
      downloadable: item.display.downloadable ? 1 : 0,
      songInfoJson: JSON.stringify(item.songInfo),
    }])

    return c.json({
      id: record.id,
      songName: record.songName,
      singers: record.singers,
      album: record.album,
      source: record.source,
      sourceIdentifier: toSourceIdentifier(JSON.parse(record.songInfoJson).identifier),
      ext: record.ext,
      fileSize: record.fileSize,
      duration: record.duration,
      coverUrl: record.coverUrl,
      downloadable: Boolean(record.downloadable),
    }, 200)
  }
  catch (error) {
    if (error instanceof MusicDlUnavailableError) {
      return c.json({ message: error.message }, 503)
    }
    if (error instanceof MusicDlBridgeError) {
      return c.json({ message: error.message }, 400)
    }
    throw error
  }
})

const createImportJobRoute = createRoute({
  method: 'post',
  path: '/music/imports',
  summary: 'Create an asynchronous import job through musicdl',
  request: {
    body: {
      content: {
        'application/json': {
          schema: MusicDlImportRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Accepted',
      content: {
        'application/json': {
          schema: MusicImportJobSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: 'Search result not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    502: {
      description: 'musicdl failed',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    503: {
      description: 'musicdl unavailable',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(createImportJobRoute, async (c) => {
  try {
    pruneExpiredMusicImportCandidates()
    const { resultId } = c.req.valid('json')
    const candidate = getMusicImportCandidateById(resultId)

    if (!candidate) {
      return c.json({ message: 'Import result expired. Please search again.' }, 404)
    }

    if (!candidate.downloadable) {
      return c.json({ message: 'This track is not downloadable.' }, 400)
    }

    const resolvedSongInfo = await resolveMusicDlSongInfo(JSON.parse(candidate.songInfoJson), config.musicdl)
    const job = createMusicImportJobFromCandidate(candidate, {
      source: resolvedSongInfo.source ?? candidate.source,
      songName: resolvedSongInfo.song_name ?? candidate.songName,
      singers: resolvedSongInfo.singers ?? candidate.singers,
      songInfoJson: JSON.stringify(resolvedSongInfo),
    })
    return c.json(toMusicImportJobResponse(job), 202)
  }
  catch (error) {
    if (error instanceof MusicDlUnavailableError) {
      return c.json({ message: error.message }, 503)
    }
    if (error instanceof MusicDlBridgeError) {
      return c.json({ message: error.message }, 502)
    }
    throw error
  }
})

const getImportJobRoute = createRoute({
  method: 'get',
  path: '/music/imports/{id}',
  summary: 'Get an import job status',
  request: {
    params: z.object({
      id: z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: 'Job status',
      content: {
        'application/json': {
          schema: MusicImportJobSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(getImportJobRoute, (c) => {
  const { id } = c.req.valid('param')
  const job = getMusicImportJobById(id)

  if (!job) {
    return c.json({ message: 'Import job not found' }, 404)
  }

  return c.json(toMusicImportJobResponse(job), 200)
})

const listMusicRoute = createRoute({
  method: 'get',
  path: '/music',
  summary: 'List uploaded music metadata',
  responses: {
    200: {
      description: 'List of music files',
      content: {
        'application/json': {
          schema: z.array(MusicSchema),
        },
      },
    },
  },
})

app.openapi(listMusicRoute, (c) => {
  const items = db.select().from(tracks).orderBy(desc(tracks.createdAt)).all()
  const playlistMap = listAllTrackPlaylistPairs()
  return c.json(items.map(item => toMusicResponse(item, playlistMap.get(item.id) ?? [])))
})

const playlistParamsSchema = z.object({
  id: z.string().min(1),
})

const playlistTrackParamsSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
})

const listPlaylistsRoute = createRoute({
  method: 'get',
  path: '/playlists',
  summary: 'List playlists',
  responses: {
    200: {
      description: 'List of playlists',
      content: {
        'application/json': {
          schema: z.array(PlaylistSchema),
        },
      },
    },
  },
})

app.openapi(listPlaylistsRoute, (c) => {
  return c.json(listPlaylists().map(item => toPlaylistSummaryResponse(item)), 200)
})

const createPlaylistRoute = createRoute({
  method: 'post',
  path: '/playlists',
  summary: 'Create a playlist',
  request: {
    body: {
      content: {
        'application/json': {
          schema: PlaylistInputSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created',
      content: {
        'application/json': {
          schema: PlaylistDetailSchema,
        },
      },
    },
  },
})

app.openapi(createPlaylistRoute, (c) => {
  const body = c.req.valid('json')
  const playlist = createPlaylist({
    name: body.name,
    description: body.description?.trim() || null,
  })
  return c.json(toPlaylistDetailResponse(playlist, []), 201)
})

const getPlaylistRoute = createRoute({
  method: 'get',
  path: '/playlists/{id}',
  summary: 'Get a playlist',
  request: {
    params: playlistParamsSchema,
  },
  responses: {
    200: {
      description: 'Playlist detail',
      content: {
        'application/json': {
          schema: PlaylistDetailSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(getPlaylistRoute, (c) => {
  const { id } = c.req.valid('param')
  const playlist = getPlaylistById(id)

  if (!playlist) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  return c.json(toPlaylistDetailResponse(playlist, getPlaylistTracks(id)), 200)
})

const updatePlaylistRoute = createRoute({
  method: 'patch',
  path: '/playlists/{id}',
  summary: 'Update a playlist',
  request: {
    params: playlistParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: PlaylistInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated',
      content: {
        'application/json': {
          schema: PlaylistDetailSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(updatePlaylistRoute, (c) => {
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const playlist = getPlaylistById(id)

  if (!playlist) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  updatePlaylist(id, {
    name: body.name,
    description: body.description?.trim() || null,
  })

  const updated = getPlaylistById(id)
  if (!updated) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  return c.json(toPlaylistDetailResponse(updated, getPlaylistTracks(id)), 200)
})

const deletePlaylistRoute = createRoute({
  method: 'delete',
  path: '/playlists/{id}',
  summary: 'Delete a playlist',
  request: {
    params: playlistParamsSchema,
  },
  responses: {
    204: {
      description: 'Deleted',
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(deletePlaylistRoute, (c) => {
  const { id } = c.req.valid('param')
  const playlist = getPlaylistById(id)

  if (!playlist) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  deletePlaylist(id)
  return c.newResponse(null, 204)
})

const addPlaylistTrackRoute = createRoute({
  method: 'post',
  path: '/playlists/{id}/tracks',
  summary: 'Add a track to a playlist',
  request: {
    params: playlistParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: PlaylistTrackInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated playlist',
      content: {
        'application/json': {
          schema: PlaylistDetailSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: 'Track already exists in playlist',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(addPlaylistTrackRoute, (c) => {
  const { id } = c.req.valid('param')
  const { trackId } = c.req.valid('json')
  const playlist = getPlaylistById(id)

  if (!playlist) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  const track = getTrackById(trackId)
  if (!track) {
    return c.json({ message: 'Music not found' }, 404)
  }

  try {
    addTrackToPlaylist(id, trackId)
  }
  catch (error) {
    if (error instanceof Error && error.message === 'Track already exists in playlist') {
      return c.json({ message: error.message }, 409)
    }
    throw error
  }

  const updated = getPlaylistById(id)
  if (!updated) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  return c.json(toPlaylistDetailResponse(updated, getPlaylistTracks(id)), 200)
})

const reorderPlaylistTracksRoute = createRoute({
  method: 'patch',
  path: '/playlists/{id}/tracks/reorder',
  summary: 'Reorder playlist tracks',
  request: {
    params: playlistParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: PlaylistReorderRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated playlist',
      content: {
        'application/json': {
          schema: PlaylistDetailSchema,
        },
      },
    },
    400: {
      description: 'Invalid order',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(reorderPlaylistTracksRoute, (c) => {
  const { id } = c.req.valid('param')
  const { trackIds } = c.req.valid('json')
  const playlist = getPlaylistById(id)

  if (!playlist) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  const normalizedTrackIds = [...new Set(trackIds)]
  const currentTrackIds = getPlaylistTrackIds(id)

  if (normalizedTrackIds.length !== trackIds.length) {
    return c.json({ message: 'Track order contains duplicate ids' }, 400)
  }

  if (normalizedTrackIds.length !== currentTrackIds.length) {
    return c.json({ message: 'Track order does not match playlist contents' }, 400)
  }

  const currentTrackIdSet = new Set(currentTrackIds)
  if (normalizedTrackIds.some(trackId => !currentTrackIdSet.has(trackId))) {
    return c.json({ message: 'Track order does not match playlist contents' }, 400)
  }

  reorderPlaylistTracks(id, normalizedTrackIds)

  const updated = getPlaylistById(id)
  if (!updated) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  return c.json(toPlaylistDetailResponse(updated, getPlaylistTracks(id)), 200)
})

const removePlaylistTrackRoute = createRoute({
  method: 'delete',
  path: '/playlists/{id}/tracks/{trackId}',
  summary: 'Remove a track from a playlist',
  request: {
    params: playlistTrackParamsSchema,
  },
  responses: {
    200: {
      description: 'Updated playlist',
      content: {
        'application/json': {
          schema: PlaylistDetailSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(removePlaylistTrackRoute, (c) => {
  const { id, trackId } = c.req.valid('param')
  const playlist = getPlaylistById(id)

  if (!playlist) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  const removed = removeTrackFromPlaylist(id, trackId)
  if (!removed) {
    return c.json({ message: 'Track not found in playlist' }, 404)
  }

  const updated = getPlaylistById(id)
  if (!updated) {
    return c.json({ message: 'Playlist not found' }, 404)
  }

  return c.json(toPlaylistDetailResponse(updated, getPlaylistTracks(id)), 200)
})

const downloadRoute = createRoute({
  method: 'get',
  path: '/music/{id}/download',
  summary: 'Download a music file by id',
  request: {
    params: z.object({
      id: z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: 'Audio stream',
      content: {
        'application/octet-stream': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

const coverRoute = createRoute({
  method: 'get',
  path: '/music/{id}/cover',
  summary: 'Get a track cover by id',
  request: {
    params: z.object({
      id: z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: 'Cover image',
      content: {
        'image/*': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

const coverThumbRoute = createRoute({
  method: 'get',
  path: '/music/{id}/cover/thumb',
  summary: 'Get a track cover thumbnail by id',
  request: {
    params: z.object({
      id: z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: 'Cover thumbnail image',
      content: {
        'image/*': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

const coverMaskRoute = createRoute({
  method: 'get',
  path: '/music/{id}/cover/mask',
  summary: 'Get a generated foreground mask for a track cover',
  request: {
    params: z.object({
      id: z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: 'Cover mask image',
      content: {
        'image/png': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

interface ParsedRange {
  start: number
  end: number
}

function parseRangeHeader(rangeHeader: string | null, size: number): ParsedRange | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return null
  }

  const value = rangeHeader.replace('bytes=', '')
  const [startString, endString] = value.split('-')

  const start = startString ? Number(startString) : Number.NaN
  const end = endString ? Number(endString) : Number.NaN

  if (Number.isNaN(start) && Number.isNaN(end)) {
    return null
  }

  if (Number.isNaN(start)) {
    const suffixLength = end
    if (Number.isNaN(suffixLength) || suffixLength <= 0) {
      return null
    }
    const boundedLength = Math.min(suffixLength, size)
    return {
      start: size - boundedLength,
      end: Math.max(size - 1, 0),
    }
  }

  const rangeStart = start
  const rangeEnd = Number.isNaN(end) ? size - 1 : end

  if (rangeStart < 0 || rangeEnd >= size || rangeStart > rangeEnd) {
    return null
  }

  return { start: rangeStart, end: rangeEnd }
}

function buildContentDisposition(filename: string): string {
  const fallback = filename
    .replaceAll(/[^\u0020-\u007E]/g, '_')
    .replaceAll(/["\\]/g, '_')
    .trim() || 'download'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function toSourceIdentifier(identifier: unknown): string | null {
  if (identifier === null || identifier === undefined) {
    return null
  }
  const value = String(identifier).trim()
  return value || null
}

app.openapi(coverRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = db.select().from(tracks).where(eq(tracks.id, id)).get()

  if (!record || !record.coverStorageKey || !record.coverStorageBackend) {
    return c.json({ message: 'Cover not found' }, 404)
  }

  const object = await getStoredTrackCover(record)
  const webStream = Readable.toWeb(object.body) as unknown as globalThis.ReadableStream

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': object.contentType ?? record.coverContentType ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    },
  })
})

app.openapi(coverThumbRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = db.select().from(tracks).where(eq(tracks.id, id)).get()

  if (!record || !record.coverStorageKey || !record.coverStorageBackend) {
    return c.json({ message: 'Cover not found' }, 404)
  }

  const object = await getStoredTrackCover(record, 'thumb')
  const webStream = Readable.toWeb(object.body) as unknown as globalThis.ReadableStream

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': object.contentType ?? record.coverThumbContentType ?? record.coverContentType ?? 'image/webp',
      'Cache-Control': 'public, max-age=3600',
    },
  })
})

app.openapi(coverMaskRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = db.select().from(tracks).where(eq(tracks.id, id)).get()

  if (!record || !record.coverStorageKey || !record.coverStorageBackend) {
    return c.json({ message: 'Cover not found' }, 404)
  }

  try {
    const buffer = await readStoredTrackCoverMaskBuffer(record)
    const body = new Blob([
      new Uint8Array(buffer),
    ], { type: 'image/png' })

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }
  catch (error) {
    if (isStorageObjectMissingError(error)) {
      return c.json({ message: 'Cover mask not found' }, 404)
    }
    throw error
  }
})

app.openapi(downloadRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = db.select().from(tracks).where(eq(tracks.id, id)).get()

  if (!record) {
    return c.json({ message: 'Music not found' }, 404)
  }

  const rangeHeader = c.req.header('range') ?? null
  const range = parseRangeHeader(rangeHeader, record.size)
  if (rangeHeader && !range) {
    return new Response('Requested Range Not Satisfiable', {
      status: 416,
      headers: {
        'Content-Range': `bytes */${record.size}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }

  const object = await getStoredTrack(record, range ?? undefined)
  const webStream = Readable.toWeb(object.body) as unknown as globalThis.ReadableStream

  const headers: Record<string, string> = {
    'Content-Type': record.contentType ?? 'application/octet-stream',
    'Content-Disposition': buildContentDisposition(record.filename),
    'Accept-Ranges': 'bytes',
  }

  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${record.size}`
    headers['Content-Length'] = `${object.contentLength}`
    return new Response(webStream, {
      status: 206,
      headers,
    })
  }

  headers['Content-Length'] = record.size.toString()

  return new Response(webStream, {
    status: 200,
    headers,
  })
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/music/{id}',
  summary: 'Delete a music file',
  request: {
    params: z.object({
      id: z.string().min(1),
    }),
  },
  responses: {
    204: {
      description: 'Deleted',
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = db.select().from(tracks).where(eq(tracks.id, id)).get()

  if (!record) {
    return c.json({ message: 'Music not found' }, 404)
  }

  await deleteStoredTrack(record)
  removeTrackFromAllPlaylists(id)
  db.delete(tracks).where(eq(tracks.id, id)).run()

  return c.newResponse(null, 204)
})

const updateMusicRoute = createRoute({
  method: 'patch',
  path: '/music/{id}',
  summary: 'Update editable track metadata (title/artists/album/source/lyrics)',
  request: {
    params: z.object({
      id: z.string().min(1),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateMusicRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated',
      content: {
        'application/json': {
          schema: MusicSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(updateMusicRoute, (c) => {
  const { id } = c.req.valid('param')
  const record = getTrackById(id)
  if (!record) {
    return c.json({ message: 'Music not found' }, 404)
  }
  const patch = c.req.valid('json')
  const next = {
    title: patch.title === undefined ? record.title : patch.title,
    artists: patch.artists === undefined ? record.artists : patch.artists,
    album: patch.album === undefined ? record.album : patch.album,
    source: patch.source === undefined ? record.source : patch.source,
    lyrics: patch.lyrics === undefined ? record.lyrics : patch.lyrics,
  }
  updateTrackEditableMetadata(id, next)
  const updated = getTrackById(id)
  if (!updated) {
    return c.json({ message: 'Music not found' }, 404)
  }
  return c.json(toMusicResponse(updated, getPlaylistIdsForTracks([updated.id]).get(updated.id) ?? []), 200)
})

const updateCoverRoute = createRoute({
  method: 'post',
  path: '/music/{id}/cover',
  summary: 'Upload a new cover image for a track',
  request: {
    params: z.object({
      id: z.string().min(1),
    }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().openapi({
              type: 'string',
              format: 'binary',
              description: 'Cover image file',
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated',
      content: {
        'application/json': {
          schema: MusicSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(updateCoverRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = getTrackById(id)
  if (!record) {
    return c.json({ message: 'Music not found' }, 404)
  }
  const formData = await c.req.formData()
  const filePart = formData.get('file')
  if (!(filePart instanceof File)) {
    return c.json({ message: 'File part is required' }, 400)
  }
  const buffer = new Uint8Array(await filePart.arrayBuffer())
  const storedCover = await storeTrackCover({
    trackId: id,
    body: buffer,
  })
  updateTrackCover(id, {
    backend: storedCover.cover.backend,
    key: storedCover.cover.key,
    contentType: storedCover.cover.contentType,
    thumbBackend: storedCover.thumb.backend,
    thumbKey: storedCover.thumb.key,
    thumbContentType: storedCover.thumb.contentType,
    thumbhash: storedCover.thumbhash,
  })
  const updated = getTrackById(id)
  if (!updated) {
    return c.json({ message: 'Music not found' }, 404)
  }
  return c.json(toMusicResponse(updated, getPlaylistIdsForTracks([updated.id]).get(updated.id) ?? []), 200)
})

const deleteCoverRoute = createRoute({
  method: 'delete',
  path: '/music/{id}/cover',
  summary: 'Remove a track cover',
  request: {
    params: z.object({
      id: z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: 'Updated',
      content: {
        'application/json': {
          schema: MusicSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(deleteCoverRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = getTrackById(id)
  if (!record) {
    return c.json({ message: 'Music not found' }, 404)
  }
  if (record.coverStorageKey && record.coverStorageBackend) {
    await deleteTrackCover(record)
    updateTrackCover(id, {
      backend: null,
      key: null,
      contentType: null,
      thumbBackend: null,
      thumbKey: null,
      thumbContentType: null,
      thumbhash: null,
    })
  }
  const updated = getTrackById(id)
  if (!updated) {
    return c.json({ message: 'Music not found' }, 404)
  }
  return c.json(toMusicResponse(updated, getPlaylistIdsForTracks([updated.id]).get(updated.id) ?? []), 200)
})

const getAppConfigRoute = createRoute({
  method: 'get',
  path: '/app/config',
  summary: 'Get non-sensitive runtime configuration',
  responses: {
    200: {
      description: 'Runtime configuration',
      content: {
        'application/json': {
          schema: AppConfigSchema,
        },
      },
    },
  },
})

app.openapi(getAppConfigRoute, (c) => {
  return c.json(toAppConfigResponse(), 200)
})

const updateAppConfigRoute = createRoute({
  method: 'patch',
  path: '/app/config',
  summary: 'Update project environment overrides',
  request: {
    body: {
      content: {
        'application/json': {
          schema: AppConfigUpdateSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated runtime configuration',
      content: {
        'application/json': {
          schema: AppConfigUpdateResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid configuration',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
})

app.openapi(updateAppConfigRoute, async (c) => {
  const update = c.req.valid('json')
  const overrides = toConfigOverrides(update)
  const candidatePersistedSource = readPersistedConfigSource()
  applyConfigOverrides(candidatePersistedSource, overrides)
  const candidateSource = mergeConfigSources(env, candidatePersistedSource, pickSecretConfigSource(env))

  let nextConfig: typeof config
  try {
    nextConfig = loadConfig(candidateSource)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid configuration'
    return c.json({ message }, 400)
  }

  await writePersistedConfigOverrides(overrides)
  applyLiveConfig(nextConfig)

  return c.json({
    config: toAppConfigResponse(nextConfig),
    restartRequired: requiresRestart(overrides),
  }, 200)
})

app.get('/', c => c.json({ status: 'ok' }))

app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Audoria API',
    version: '1.0.0',
  },
})

type ScalarDocsConfig = Partial<ApiReferenceConfiguration> & {
  spec?: {
    url?: string
    content?: string
  }
}

const docsMiddleware = Scalar({
  spec: {
    url: '/openapi.json',
  },
  pageTitle: 'Audoria API Reference',
} as ScalarDocsConfig)

app.get('/docs', docsMiddleware)

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.warn(`Server is running on http://localhost:${info.port}`)
  },
)
