import type { StorageBackend } from './config.js'
import type { Track } from './db.js'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { config } from './config.js'
import { db, tracks } from './db.js'
import { formatDurationText, probeDurationSeconds } from './probeAudio.js'

interface ByteRange { start: number, end: number }

interface StoredObject {
  body: Readable
  contentType: string | null
  contentLength: number
}

interface ObjectRef {
  backend: StorageBackend
  key: string
}

type StoredCover = ObjectRef & {
  contentType: string | null
}

interface StorageDriver {
  putObject: (input: {
    key: string
    body: Buffer
    contentType: string | null
  }) => Promise<void>
  getObject: (input: {
    key: string
    range?: ByteRange
  }) => Promise<StoredObject>
  deleteObject: (key: string) => Promise<void>
}

function getActiveStorageBackend(): StorageBackend {
  return config.storage.backend
}

const configuredS3Client = config.storage.s3
  ? new S3Client({
      endpoint: config.storage.s3.endpoint,
      region: config.storage.s3.region,
      forcePathStyle: config.storage.s3.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey,
      },
    })
  : null

function getS3Client(): S3Client {
  if (!configuredS3Client) {
    throw new Error('S3 storage is not configured')
  }
  return configuredS3Client
}

const s3Driver: StorageDriver = {
  async putObject({ key, body, contentType }) {
    const s3 = config.storage.s3
    if (!s3) {
      throw new Error('S3 storage is not configured')
    }
    const client = getS3Client()
    await client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType || undefined,
        ContentLength: body.byteLength,
      }),
    )
  },

  async getObject({ key, range }) {
    const s3 = config.storage.s3
    if (!s3) {
      throw new Error('S3 storage is not configured')
    }
    const client = getS3Client()
    const object = await client.send(
      new GetObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    )
    return {
      body: toNodeReadable(object.Body),
      contentType: object.ContentType ?? null,
      contentLength: Number(object.ContentLength ?? 0),
    }
  },

  async deleteObject(key) {
    const s3 = config.storage.s3
    if (!s3) {
      throw new Error('S3 storage is not configured')
    }
    const client = getS3Client()
    await client.send(
      new DeleteObjectCommand({
        Bucket: s3.bucket,
        Key: key,
      }),
    )
  },
}

function normalizeStorageKey(key: string): string {
  const normalized = key.replaceAll('\\', '/').replace(/^\/+/, '').trim()
  if (!normalized) {
    throw new Error('Storage key must not be empty')
  }
  return normalized
}

function resolveFsPath(key: string): string {
  const fsStorage = config.storage.fs
  if (!fsStorage) {
    throw new Error('Filesystem storage is not configured')
  }
  const normalizedKey = normalizeStorageKey(key)
  const resolvedPath = path.resolve(fsStorage.rootDir, normalizedKey)
  const relativePath = path.relative(fsStorage.rootDir, resolvedPath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid storage key: ${key}`)
  }
  return resolvedPath
}

const fsDriver: StorageDriver = {
  async putObject({ key, body }) {
    const targetPath = resolveFsPath(key)
    const directory = path.dirname(targetPath)
    await mkdir(directory, { recursive: true })

    const tempPath = `${targetPath}.${randomUUID()}.tmp`
    const handle = await open(tempPath, 'w')
    try {
      await handle.writeFile(body)
      await handle.sync()
      await handle.close()
      await rename(tempPath, targetPath)
    }
    catch (error) {
      await handle.close().catch(() => {})
      await unlink(tempPath).catch(() => {})
      throw error
    }
  },

  async getObject({ key, range }) {
    const targetPath = resolveFsPath(key)
    const stats = await stat(targetPath)
    const body = createReadStream(targetPath, range ? { start: range.start, end: range.end } : undefined)
    return {
      body,
      contentType: null,
      contentLength: range ? range.end - range.start + 1 : stats.size,
    }
  },

  async deleteObject(key) {
    const targetPath = resolveFsPath(key)
    await rm(targetPath, { force: true })
  },
}

function getStorageDriver(backend: StorageBackend): StorageDriver {
  if (backend === 'fs') {
    return fsDriver
  }
  return s3Driver
}

function toNodeReadable(body: unknown): Readable {
  if (!body) {
    throw new Error('Missing object body')
  }
  if (body instanceof Readable) {
    return body
  }
  if (body instanceof Uint8Array) {
    return Readable.from([Buffer.from(body)])
  }
  if (typeof body === 'object' && body !== null) {
    if (Symbol.asyncIterator in body && typeof body[Symbol.asyncIterator] === 'function') {
      return Readable.from(body as AsyncIterable<Uint8Array>)
    }
    if ('transformToWebStream' in body && typeof body.transformToWebStream === 'function') {
      const webStream = body.transformToWebStream() as globalThis.ReadableStream<Uint8Array>
      return Readable.from((async function* () {
        const reader = webStream.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              return
            }
            if (value) {
              yield Buffer.from(value)
            }
          }
        }
        finally {
          reader.releaseLock()
        }
      })())
    }
    if ('transformToByteArray' in body && typeof body.transformToByteArray === 'function') {
      const byteArrayPromise = body.transformToByteArray() as Promise<Uint8Array>
      return Readable.from((async function* () {
        yield Buffer.from(await byteArrayPromise)
      })())
    }
  }
  throw new TypeError('Unsupported storage body type')
}

async function readReadableToBuffer(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const rawChunk of body) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function probeAudioDuration(
  buffer: Buffer,
  contentType: string | null,
): Promise<{ durationSeconds: number | null, durationText: string | null }> {
  const seconds = await probeDurationSeconds(buffer, contentType)
  if (seconds === null) {
    return { durationSeconds: null, durationText: null }
  }
  return { durationSeconds: seconds, durationText: formatDurationText(seconds) }
}

function getTrackObjectRef(record: Track): ObjectRef {
  return {
    backend: record.storageBackend as StorageBackend,
    key: record.storageKey,
  }
}

function getCoverObjectRef(record: Track): ObjectRef | null {
  if (!record.coverStorageBackend || !record.coverStorageKey) {
    return null
  }
  return {
    backend: record.coverStorageBackend as StorageBackend,
    key: record.coverStorageKey,
  }
}

export async function storeTrack({
  filename,
  contentType,
  body,
  onProgress,
}: {
  filename: string
  contentType: string | null
  size?: number | null
  body: Readable
  onProgress?: (transferredBytes: number) => void
}): Promise<Track> {
  const id = randomUUID()
  const storageKey = `music/${id}-${filename || 'audio'}`
  const createdAt = Date.now()

  const chunks: Buffer[] = []
  let countedBytes = 0
  for await (const rawChunk of body) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array)
    chunks.push(chunk)
    countedBytes += chunk.byteLength
    onProgress?.(countedBytes)
  }
  const buffer = Buffer.concat(chunks)
  const resolvedSize = buffer.byteLength

  const { durationSeconds, durationText } = await probeAudioDuration(buffer, contentType)

  const storageBackend = getActiveStorageBackend()
  await getStorageDriver(storageBackend).putObject({
    key: storageKey,
    body: buffer,
    contentType,
  })
  onProgress?.(resolvedSize)

  const record: Track = {
    id,
    filename: filename || 'audio',
    storageBackend,
    storageKey,
    coverStorageBackend: null,
    coverStorageKey: null,
    coverContentType: null,
    title: null,
    artists: null,
    album: null,
    source: null,
    sourceIdentifier: null,
    durationText,
    durationSeconds,
    size: resolvedSize,
    contentType,
    lyrics: null,
    createdAt,
  }

  db.insert(tracks).values(record).run()
  return record
}

export async function storeTrackCover({
  trackId,
  contentType,
  body,
}: {
  trackId: string
  contentType: string | null
  size: number
  body: Uint8Array
}): Promise<StoredCover> {
  const key = `covers/${trackId}`
  const storageBackend = getActiveStorageBackend()
  await getStorageDriver(storageBackend).putObject({
    key,
    body: Buffer.from(body),
    contentType,
  })
  return {
    backend: storageBackend,
    key,
    contentType,
  }
}

export async function getStoredTrack(record: Track, range?: ByteRange): Promise<StoredObject> {
  const ref = getTrackObjectRef(record)
  return getStorageDriver(ref.backend).getObject({
    key: ref.key,
    range,
  })
}

export async function getStoredTrackCover(record: Track): Promise<StoredObject> {
  const ref = getCoverObjectRef(record)
  if (!ref) {
    throw new Error('Track cover is not stored')
  }
  return getStorageDriver(ref.backend).getObject({ key: ref.key })
}

export async function readStoredTrackBuffer(record: Track): Promise<Buffer> {
  const object = await getStoredTrack(record)
  return readReadableToBuffer(object.body)
}

export async function deleteStoredTrack(record: Track): Promise<void> {
  const trackRef = getTrackObjectRef(record)
  await getStorageDriver(trackRef.backend).deleteObject(trackRef.key)

  const coverRef = getCoverObjectRef(record)
  if (coverRef) {
    await getStorageDriver(coverRef.backend).deleteObject(coverRef.key)
  }
}

export async function deleteTrackCover(record: Track): Promise<void> {
  const coverRef = getCoverObjectRef(record)
  if (!coverRef) {
    return
  }
  await getStorageDriver(coverRef.backend).deleteObject(coverRef.key)
}
