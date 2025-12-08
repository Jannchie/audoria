import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, type GetObjectCommandOutput } from '@aws-sdk/client-s3'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { Scalar , type ApiReferenceConfiguration } from '@scalar/hono-api-reference'
import Database from 'better-sqlite3'
import { config as loadEnv } from 'dotenv'
import { desc, eq, type InferSelectModel } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { env } from 'node:process'
import { Readable } from 'node:stream'
import { ReadableStream } from 'node:stream/web'

type S3Config = {
  bucket: string
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

type AppConfig = {
  port: number
  dbPath: string
  s3: S3Config
}

const requireEnv = (key: string): string => {
  const value = env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

const loadConfig = (): AppConfig => {
  const dbPath = resolve(env.DB_PATH ?? './data/audoria.sqlite')
  mkdirSync(dirname(dbPath), { recursive: true })

  return {
    port: Number(env.PORT ?? '8787'),
    dbPath,
    s3: {
      bucket: requireEnv('S3_BUCKET'),
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? 'us-east-1',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'false' ? false : true
    }
  }
}

loadEnv()

const config = loadConfig()

const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  s3Key: text('s3_key').notNull(),
  size: integer('size', { mode: 'number' }).notNull(),
  contentType: text('content_type'),
  createdAt: integer('created_at', { mode: 'number' }).notNull()
})

type Track = InferSelectModel<typeof tracks>

const sqlite = new Database(config.dbPath)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    s3_key TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_type TEXT,
    created_at INTEGER NOT NULL
  );
`)

const db = drizzle(sqlite)

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  }
})

const toMusicResponse = (row: Track) => ({
  id: row.id,
  filename: row.filename,
  size: row.size,
  contentType: row.contentType,
  createdAt: new Date(row.createdAt).toISOString()
})

const MusicSchema = z.object({
  id: z.string().openapi({ example: 'a3f9d3d1-9c9d-4a40-a54d-0e4cb7acb8a0' }),
  filename: z.string().openapi({ example: 'track.mp3' }),
  size: z.number().int().nonnegative().openapi({ example: 1280000 }),
  contentType: z.string().nullable().openapi({ example: 'audio/mpeg' }),
  createdAt: z.string().datetime().openapi({ example: '2024-01-01T12:00:00.000Z' })
}).openapi('Music')

const ErrorSchema = z.object({
  message: z.string()
})

const app = new OpenAPIHono()

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization']
  })
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
              description: 'Audio file to store'
            })
          })
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created',
      content: {
        'application/json': {
          schema: MusicSchema
        }
      }
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorSchema
        }
      }
    }
  }
})

app.openapi(uploadMusicRoute, async (c) => {
  const formData = await c.req.formData()
  const filePart = formData.get('file')

  if (!(filePart instanceof File)) {
    return c.json({ message: 'File part is required' }, 400)
  }

  const id = randomUUID()
  const key = `music/${id}-${filePart.name || 'audio'}`
  const createdAt = Date.now()

  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: Readable.fromWeb(filePart.stream() as unknown as ReadableStream),
      ContentType: filePart.type || undefined,
      ContentLength: filePart.size
    })
  )

  const record: Track = {
    id,
    filename: filePart.name || 'audio',
    s3Key: key,
    size: Number(filePart.size),
    contentType: filePart.type || null,
    createdAt
  }

  db.insert(tracks).values(record).run()

  return c.json(toMusicResponse(record), 201)
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
          schema: z.array(MusicSchema)
        }
      }
    }
  }
})

app.openapi(listMusicRoute, (c) => {
  const items = db.select().from(tracks).orderBy(desc(tracks.createdAt)).all()
  return c.json(items.map(toMusicResponse))
})

const downloadRoute = createRoute({
  method: 'get',
  path: '/music/{id}/download',
  summary: 'Download a music file by id',
  request: {
    params: z.object({
      id: z.string().min(1)
    })
  },
  responses: {
    200: {
      description: 'Audio stream',
      content: {
        'application/octet-stream': {
          schema: z.string().openapi({ format: 'binary' })
        }
      }
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema
        }
      }
    }
  }
})

const toWebStream = (body: GetObjectCommandOutput['Body']): ReadableStream => {
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

app.openapi(downloadRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = db.select().from(tracks).where(eq(tracks.id, id)).get()

  if (!record) {
    return c.json({ message: 'Music not found' }, 404)
  }

  const object = await s3Client.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: record.s3Key
    })
  )

  const stream = toWebStream(object.Body)

  const webStream = stream as unknown as globalThis.ReadableStream

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': record.contentType ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${record.filename}"`,
      'Content-Length': record.size.toString()
    }
  })
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/music/{id}',
  summary: 'Delete a music file',
  request: {
    params: z.object({
      id: z.string().min(1)
    })
  },
  responses: {
    204: {
      description: 'Deleted'
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: ErrorSchema
        }
      }
    }
  }
})

app.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param')
  const record = db.select().from(tracks).where(eq(tracks.id, id)).get()

  if (!record) {
    return c.json({ message: 'Music not found' }, 404)
  }

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: record.s3Key
    })
  )

  db.delete(tracks).where(eq(tracks.id, id)).run()

  return c.newResponse(null, 204)
})

app.get('/', (c) => c.json({ status: 'ok' }))

app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Audoria API',
    version: '1.0.0'
  }
})

type ScalarDocsConfig = Partial<ApiReferenceConfiguration> & {
  spec?: {
    url?: string
    content?: string
  }
}

const docsMiddleware = Scalar({
  spec: {
    url: '/openapi.json'
  },
  pageTitle: 'Audoria API Reference'
} as ScalarDocsConfig)

app.get('/docs', docsMiddleware)

serve(
  {
    fetch: app.fetch,
    port: config.port
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  }
)
