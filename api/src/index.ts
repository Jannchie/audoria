import type { GetObjectCommandOutput } from '@aws-sdk/client-s3'
import type { ApiReferenceConfiguration } from '@scalar/hono-api-reference'
import type { ReadableStream } from 'node:stream/web'
import type { MusicImportJob, MusicImportJobStatus, Track } from './db.js'
import { Readable } from 'node:stream'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { serve } from '@hono/node-server'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { desc, eq } from 'drizzle-orm'
import { cors } from 'hono/cors'
import { config } from './config.js'
import {
  createMusicImportJobFromCandidate,
  db,
  getMusicImportCandidateById,
  getMusicImportJobById,
  insertMusicImportCandidates,
  pruneExpiredMusicImportCandidates,
  tracks,

} from './db.js'
import { MusicDlBridgeError, musicDlSources, MusicDlUnavailableError, resolveMusicDlSongInfo, searchMusicDl } from './musicdl.js'
import { deleteStoredTrack, storeTrack } from './storage.js'

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
})

function toMusicResponse(row: Track) {
  return {
    id: row.id,
    filename: row.filename,
    size: row.size,
    contentType: row.contentType,
    coverUrl: row.coverS3Key ? `/music/${row.id}/cover` : null,
    lyrics: row.lyrics,
    title: row.title,
    artists: row.artists,
    album: row.album,
    source: row.source,
    durationText: row.durationText,
    durationSeconds: row.durationSeconds,
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

const MusicSchema = z.object({
  id: z.string().openapi({ example: 'a3f9d3d1-9c9d-4a40-a54d-0e4cb7acb8a0' }),
  filename: z.string().openapi({ example: 'track.mp3' }),
  size: z.number().int().nonnegative().openapi({ example: 1_280_000 }),
  contentType: z.string().nullable().openapi({ example: 'audio/mpeg' }),
  coverUrl: z.string().nullable().openapi({ example: '/music/a3f9d3d1-9c9d-4a40-a54d-0e4cb7acb8a0/cover' }),
  lyrics: z.string().nullable().openapi({ example: '[00:00.00] Lyrics line' }),
  title: z.string().nullable().openapi({ example: '稻香' }),
  artists: z.string().nullable().openapi({ example: '周杰伦' }),
  album: z.string().nullable().openapi({ example: '魔杰座' }),
  source: z.string().nullable().openapi({ example: 'NeteaseMusicClient' }),
  durationText: z.string().nullable().openapi({ example: '00:03:43' }),
  durationSeconds: z.number().int().nullable().openapi({ example: 223 }),
  createdAt: z.string().datetime().openapi({ example: '2024-01-01T12:00:00.000Z' }),
}).openapi('Music')

const ErrorSchema = z.object({
  message: z.string(),
})

const MusicDlSourceSchema = z.enum(musicDlSources).openapi('MusicDlSource')

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

const app = new OpenAPIHono()

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
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
  return c.json(items.map(item => toMusicResponse(item)))
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

function toWebStream(body: GetObjectCommandOutput['Body']): ReadableStream {
  if (!body) {
    throw new Error('Missing object body')
  }

  if (body instanceof Readable) {
    return Readable.toWeb(body) as unknown as ReadableStream
  }

  if (body instanceof Uint8Array) {
    return Readable.toWeb(Readable.from(body)) as unknown as ReadableStream
  }

  if ('transformToWebStream' in body && typeof body.transformToWebStream === 'function') {
    return body.transformToWebStream() as unknown as ReadableStream
  }

  return body as ReadableStream
}

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

app.openapi(coverRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = db.select().from(tracks).where(eq(tracks.id, id)).get()

  if (!record || !record.coverS3Key) {
    return c.json({ message: 'Cover not found' }, 404)
  }

  const object = await s3Client.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: record.coverS3Key,
    }),
  )
  const stream = toWebStream(object.Body)
  const webStream = stream as unknown as globalThis.ReadableStream

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': object.ContentType ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    },
  })
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

  const rangeHeaders: { Range?: string } = {}
  if (range) {
    rangeHeaders.Range = `bytes=${range.start}-${range.end}`
  }

  const object = await s3Client.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: record.s3Key,
      ...rangeHeaders,
    }),
  )

  const stream = toWebStream(object.Body)
  const webStream = stream as unknown as globalThis.ReadableStream

  const headers: Record<string, string> = {
    'Content-Type': record.contentType ?? 'application/octet-stream',
    'Content-Disposition': buildContentDisposition(record.filename),
    'Accept-Ranges': 'bytes',
  }

  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${record.size}`
    headers['Content-Length'] = `${range.end - range.start + 1}`
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
  db.delete(tracks).where(eq(tracks.id, id)).run()

  return c.newResponse(null, 204)
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
