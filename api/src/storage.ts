import type { StorageBackend } from './config.js'
import type { Track } from './db/schema.js'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, open, rename, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline, Readable, Transform } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { rgbaToThumbHash } from 'thumbhash'
import { AUDIO_SNIFF_BYTES, sniffAudioFormat, withAudioExtension } from './audioFormat.js'
import { config } from './config.js'
import { __db as db, listTracks, tracks, updateTrackFileFormat, updateTrackStoredFile } from './db/index.js'
import { formatDurationText, probeDurationSecondsFromFile, readEmbeddedMetadata, remuxFlacToMp4 } from './probeAudio.js'

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

type StorageBody = Buffer | Readable

type StoredCoverAsset = ObjectRef & {
  contentType: string | null
}

interface StoredCover {
  cover: StoredCoverAsset
  thumb: StoredCoverAsset
  thumbhash: string
}

type CoverVariant = 'cover' | 'thumb'

const COVER_CONTENT_TYPE = 'image/webp'
const COVER_MASK_KEY_SUFFIX = 'mask-v1'
const COVER_MASK_CONTENT_TYPE = 'image/png'
const COVER_VARIANT_OPTIONS: Record<CoverVariant, { width: number, height: number, quality: number, suffix: string }> = {
  cover: {
    width: 1200,
    height: 1200,
    quality: 82,
    suffix: 'cover',
  },
  thumb: {
    width: 320,
    height: 320,
    quality: 76,
    suffix: 'thumb',
  },
}

interface StorageDriver {
  putObject: (input: {
    key: string
    body: StorageBody
    contentType: string | null
    contentLength?: number | null
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

// A paused or abandoned download keeps its S3 socket out of the pool; once the
// pool fills, every other request (uploads included) queues behind them forever.
const S3_MAX_SOCKETS = 200
const S3_BODY_IDLE_TIMEOUT_MS = 30_000

const configuredS3Client = config.storage.s3
  ? new S3Client({
      endpoint: config.storage.s3.endpoint,
      region: config.storage.s3.region,
      forcePathStyle: config.storage.s3.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      requestHandler: {
        httpsAgent: { keepAlive: true, maxSockets: S3_MAX_SOCKETS },
        httpAgent: { keepAlive: true, maxSockets: S3_MAX_SOCKETS },
      },
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
  async putObject({ key, body, contentType, contentLength }) {
    const s3 = config.storage.s3
    if (!s3) {
      throw new Error('S3 storage is not configured')
    }
    const client = getS3Client()
    const resolvedContentLength = contentLength ?? (Buffer.isBuffer(body) ? body.byteLength : undefined)
    await client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType || undefined,
        ContentLength: resolvedContentLength ?? undefined,
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
      body: destroyWhenIdle(toNodeReadable(object.Body), S3_BODY_IDLE_TIMEOUT_MS),
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
    try {
      await writeStorageBodyToFile(tempPath, body)
      await rename(tempPath, targetPath)
    }
    catch (error) {
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

function toBufferChunk(rawChunk: unknown): Buffer {
  return Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array)
}

async function writeStorageBodyToFile(
  filePath: string,
  body: StorageBody,
  onProgress?: (transferredBytes: number) => void,
): Promise<number> {
  const handle = await open(filePath, 'w')
  let countedBytes = 0
  try {
    if (Buffer.isBuffer(body)) {
      await handle.writeFile(body)
      countedBytes = body.byteLength
      onProgress?.(countedBytes)
    }
    else {
      for await (const rawChunk of body) {
        const chunk = toBufferChunk(rawChunk)
        await handle.writeFile(chunk)
        countedBytes += chunk.byteLength
        onProgress?.(countedBytes)
      }
    }
    await handle.sync()
    return countedBytes
  }
  finally {
    await handle.close().catch(() => {})
  }
}

/**
 * Destroys an S3 response body that passes no data for `idleMs`, which happens
 * when the client stops reading (a paused player) or disconnects without the
 * cancel reaching us. Destroying it frees the pooled socket.
 */
function destroyWhenIdle(body: Readable, idleMs: number): Readable {
  let timer: NodeJS.Timeout | undefined
  const watched = new Transform({
    transform(chunk, _encoding, callback) {
      timer?.refresh()
      callback(null, chunk)
    },
  })
  timer = setTimeout(() => {
    watched.destroy(new Error(`S3 response body idle for ${idleMs} ms`))
  }, idleMs)
  pipeline(body, watched, () => {
    clearTimeout(timer)
  })
  return watched
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
    chunks.push(toBufferChunk(rawChunk))
  }
  return Buffer.concat(chunks)
}

async function probeAudioDuration(
  filePath: string,
): Promise<{ durationSeconds: number | null, durationText: string | null }> {
  const seconds = await probeDurationSecondsFromFile(filePath)
  if (seconds === null) {
    return { durationSeconds: null, durationText: null }
  }
  return { durationSeconds: seconds, durationText: formatDurationText(seconds) }
}

async function writeTrackBodyToTempFile(
  body: Readable,
  onProgress?: (transferredBytes: number) => void,
): Promise<{ filePath: string, size: number, cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'audoria-upload-'))
  const filePath = path.join(directory, 'track.bin')
  try {
    const size = await writeStorageBodyToFile(filePath, body, onProgress)
    return {
      filePath,
      size,
      cleanup: async () => {
        await rm(directory, { recursive: true, force: true }).catch(() => {})
      },
    }
  }
  catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function readFileHead(filePath: string, length: number): Promise<Uint8Array> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  }
  finally {
    await handle.close()
  }
}

interface PreparedTrackFile {
  filePath: string
  size: number
  filename: string
  contentType: string | null
}

/**
 * Labels an audio file by its actual bytes rather than the name and type it
 * arrived with, and moves FLAC into MP4 so Safari can seek it (see
 * remuxFlacToMp4). Any remuxed copy is written next to the input, so it is
 * cleaned up with the input's temp directory.
 */
async function prepareTrackFile(filePath: string, filename: string, contentType: string | null): Promise<PreparedTrackFile> {
  const format = sniffAudioFormat(await readFileHead(filePath, AUDIO_SNIFF_BYTES))
  if (format?.contentType === 'audio/flac') {
    const remuxedPath = `${filePath}.m4a`
    if (await remuxFlacToMp4(filePath, remuxedPath)) {
      const remuxed = await stat(remuxedPath)
      return {
        filePath: remuxedPath,
        size: remuxed.size,
        filename: withAudioExtension(filename, '.m4a'),
        contentType: 'audio/mp4',
      }
    }
  }
  const original = await stat(filePath)
  return {
    filePath,
    size: original.size,
    filename: format ? withAudioExtension(filename, format.ext) : filename,
    contentType: format?.contentType ?? contentType,
  }
}

function getTrackObjectRef(record: Track): ObjectRef {
  return {
    backend: record.storageBackend as StorageBackend,
    key: record.storageKey,
  }
}

function getTrackCoverMaskKey(trackId: string): string {
  return `covers/${trackId}/${COVER_MASK_KEY_SUFFIX}.png`
}

function getCoverObjectRef(record: Track, variant: CoverVariant = 'cover'): ObjectRef | null {
  if (variant === 'thumb' && record.coverThumbStorageBackend && record.coverThumbStorageKey) {
    return {
      backend: record.coverThumbStorageBackend as StorageBackend,
      key: record.coverThumbStorageKey,
    }
  }
  if (!record.coverStorageBackend || !record.coverStorageKey) {
    return null
  }
  return {
    backend: record.coverStorageBackend as StorageBackend,
    key: record.coverStorageKey,
  }
}

function getCoverMaskObjectRef(record: Track): ObjectRef | null {
  if (!record.coverStorageBackend || !record.coverStorageKey) {
    return null
  }
  return {
    backend: record.coverStorageBackend as StorageBackend,
    key: getTrackCoverMaskKey(record.id),
  }
}

function listCoverObjectRefs(record: Track): ObjectRef[] {
  const refs = [
    getCoverObjectRef(record, 'cover'),
    getCoverObjectRef(record, 'thumb'),
    getCoverMaskObjectRef(record),
  ].filter((value): value is ObjectRef => value !== null)

  return refs.filter((ref, index) =>
    refs.findIndex(candidate => candidate.backend === ref.backend && candidate.key === ref.key) === index,
  )
}

async function createCoverVariant(body: Uint8Array, variant: CoverVariant): Promise<Buffer> {
  const { width, height, quality } = COVER_VARIANT_OPTIONS[variant]
  return await sharp(body)
    .rotate()
    .resize({
      width,
      height,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer()
}

export async function createCoverThumbhash(body: Uint8Array): Promise<string> {
  const { data, info } = await sharp(body)
    .rotate()
    .resize({
      width: 100,
      height: 100,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const hash = rgbaToThumbHash(info.width, info.height, data)
  return Buffer.from(hash).toString('base64')
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
  const tempFile = await writeTrackBodyToTempFile(body, onProgress)
  try {
    const record = await storeTrackFile({ filePath: tempFile.filePath, filename, contentType })
    onProgress?.(tempFile.size)
    return record
  }
  finally {
    await tempFile.cleanup()
  }
}

/**
 * Stores an audio file that is already on local disk. A FLAC remux is written
 * next to it, so the caller owns the file's directory and removes it afterwards.
 */
export async function storeTrackFile({
  filePath,
  filename,
  contentType,
}: {
  filePath: string
  filename: string
  contentType: string | null
}): Promise<Track> {
  const id = randomUUID()
  const createdAt = Date.now()

  const prepared = await prepareTrackFile(filePath, filename || 'audio', contentType)
  const storageKey = `music/${id}-${prepared.filename}`

  const [{ durationSeconds, durationText }, embedded] = await Promise.all([
    probeAudioDuration(filePath),
    readEmbeddedMetadata(filePath),
  ])

  const storageBackend = getActiveStorageBackend()
  await getStorageDriver(storageBackend).putObject({
    key: storageKey,
    body: createReadStream(prepared.filePath),
    contentType: prepared.contentType,
    contentLength: prepared.size,
  })

  let embeddedCover: StoredCover | null = null
  if (embedded.cover) {
    try {
      embeddedCover = await storeTrackCover({ trackId: id, body: embedded.cover })
    }
    catch (error) {
      console.warn(`Failed to store embedded cover for ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const record: Track = {
    id,
    filename: prepared.filename,
    storageBackend,
    storageKey,
    coverStorageBackend: embeddedCover?.cover.backend ?? null,
    coverStorageKey: embeddedCover?.cover.key ?? null,
    coverContentType: embeddedCover?.cover.contentType ?? null,
    coverThumbStorageBackend: embeddedCover?.thumb.backend ?? null,
    coverThumbStorageKey: embeddedCover?.thumb.key ?? null,
    coverThumbContentType: embeddedCover?.thumb.contentType ?? null,
    coverThumbhash: embeddedCover?.thumbhash ?? null,
    coverMaskRequestedAt: embeddedCover ? createdAt : null,
    title: embedded.title,
    artists: embedded.artists,
    album: embedded.album,
    source: null,
    sourceIdentifier: null,
    durationText,
    durationSeconds,
    size: prepared.size,
    contentType: prepared.contentType,
    lyrics: embedded.lyrics,
    lyricsDoc: null,
    sortOrder: null,
    playCount: 0,
    skipCount: 0,
    listenedSeconds: 0,
    lastPlayedAt: null,
    createdAt,
  }

  db.insert(tracks).values(record).run()
  return record
}

export async function storeTrackCover({
  trackId,
  body,
}: {
  trackId: string
  body: Uint8Array
}): Promise<StoredCover> {
  const storageBackend = getActiveStorageBackend()
  const driver = getStorageDriver(storageBackend)
  const [
    coverBody,
    thumbBody,
    thumbhash,
  ] = await Promise.all([
    createCoverVariant(body, 'cover'),
    createCoverVariant(body, 'thumb'),
    createCoverThumbhash(body),
  ])
  // The foreground mask is left to the import worker (see coverMaskRequestedAt),
  // so this process never loads the mask model.
  const coverKey = `covers/${trackId}/${COVER_VARIANT_OPTIONS.cover.suffix}.webp`
  const thumbKey = `covers/${trackId}/${COVER_VARIANT_OPTIONS.thumb.suffix}.webp`

  await Promise.all([
    driver.putObject({
      key: coverKey,
      body: coverBody,
      contentType: COVER_CONTENT_TYPE,
    }),
    driver.putObject({
      key: thumbKey,
      body: thumbBody,
      contentType: COVER_CONTENT_TYPE,
    }),
  ])

  return {
    cover: {
      backend: storageBackend,
      key: coverKey,
      contentType: COVER_CONTENT_TYPE,
    },
    thumb: {
      backend: storageBackend,
      key: thumbKey,
      contentType: COVER_CONTENT_TYPE,
    },
    thumbhash,
  }
}

export async function getStoredTrackCover(record: Track, variant: CoverVariant = 'cover'): Promise<StoredObject> {
  const ref = getCoverObjectRef(record, variant)
  if (!ref) {
    throw new Error('Track cover is not stored')
  }
  return getStorageDriver(ref.backend).getObject({ key: ref.key })
}

export async function getStoredTrackCoverMask(record: Track): Promise<StoredObject> {
  const ref = getCoverMaskObjectRef(record)
  if (!ref) {
    throw new Error('Track cover mask is not stored')
  }
  return getStorageDriver(ref.backend).getObject({ key: ref.key })
}

export async function readStoredTrackCoverBuffer(record: Track, variant: CoverVariant = 'cover'): Promise<Buffer> {
  const object = await getStoredTrackCover(record, variant)
  return readReadableToBuffer(object.body)
}

export async function readStoredTrackCoverMaskBuffer(record: Track): Promise<Buffer> {
  const object = await getStoredTrackCoverMask(record)
  return readReadableToBuffer(object.body)
}

export async function storeTrackCoverMask(record: Track): Promise<void> {
  const ref = getCoverMaskObjectRef(record)
  if (!ref) {
    throw new Error('Track cover is not stored')
  }
  // Loaded on demand so only the process that generates masks pulls in
  // onnxruntime and the model.
  const { generateCoverMaskPng } = await import('./coverMask.js')
  const coverObject = await getStoredTrackCover(record)
  const coverBody = await readReadableToBuffer(coverObject.body)
  const maskBody = await generateCoverMaskPng(
    coverBody,
    coverObject.contentType ?? record.coverContentType ?? COVER_CONTENT_TYPE,
  )
  await getStorageDriver(ref.backend).putObject({
    key: ref.key,
    body: maskBody,
    contentType: COVER_MASK_CONTENT_TYPE,
  })
}

export async function deleteStoredTrack(record: Track): Promise<void> {
  const trackRef = getTrackObjectRef(record)
  await getStorageDriver(trackRef.backend).deleteObject(trackRef.key).catch((err: unknown) => {
    if (!isStorageObjectMissingError(err)) throw err
  })

  const coverRefs = listCoverObjectRefs(record)
  await Promise.all(coverRefs.map(ref =>
    getStorageDriver(ref.backend).deleteObject(ref.key).catch((err: unknown) => {
      if (!isStorageObjectMissingError(err)) throw err
    }),
  ))
}

export async function deleteTrackCover(record: Track): Promise<void> {
  const coverRefs = listCoverObjectRefs(record)
  await Promise.all(coverRefs.map(ref => getStorageDriver(ref.backend).deleteObject(ref.key)))
}

export async function deleteTrackCoverExcept(record: Track, keepRefs: ObjectRef[]): Promise<void> {
  const keepKeys = new Set(keepRefs.map(ref => `${ref.backend}:${ref.key}`))
  const coverRefs = listCoverObjectRefs(record)
    .filter(ref => !keepKeys.has(`${ref.backend}:${ref.key}`))
  await Promise.all(coverRefs.map(ref => getStorageDriver(ref.backend).deleteObject(ref.key)))
}

/**
 * Re-derives each stored track's content type and extension from its leading
 * bytes, fixing records imported before uploads were sniffed. Returns how many
 * records changed. Only reads a few bytes per track, so it is cheap to rerun.
 */
export async function repairTrackFormats(): Promise<number> {
  let repaired = 0
  for (const record of await listTracks()) {
    try {
      const object = await getStoredTrack(record, { start: 0, end: Math.min(record.size, AUDIO_SNIFF_BYTES) - 1 })
      const format = sniffAudioFormat(await readReadableToBuffer(object.body))
      if (!format) {
        continue
      }
      const filename = withAudioExtension(record.filename, format.ext)
      if (format.contentType === record.contentType && filename === record.filename) {
        continue
      }
      await updateTrackFileFormat(record.id, { filename, contentType: format.contentType })
      repaired += 1
    }
    catch (error) {
      console.warn(`Failed to check format of ${record.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return repaired
}

/**
 * Moves every stored FLAC track into MP4 (see prepareTrackFile). The new
 * object is written and the record repointed before the old object is
 * deleted, so a failure midway leaves the track playable. Returns how many
 * tracks were converted; tracks already in MP4 are skipped, so reruns are cheap.
 */
export async function migrateFlacTracksToMp4(): Promise<number> {
  let migrated = 0
  for (const record of await listTracks()) {
    if (record.contentType !== 'audio/flac') {
      continue
    }
    try {
      const object = await getStoredTrack(record)
      const tempFile = await writeTrackBodyToTempFile(object.body)
      try {
        const prepared = await prepareTrackFile(tempFile.filePath, record.filename, record.contentType)
        if (prepared.contentType !== 'audio/mp4') {
          continue
        }
        const storageBackend = getActiveStorageBackend()
        const storageKey = `music/${record.id}-${prepared.filename}`
        await getStorageDriver(storageBackend).putObject({
          key: storageKey,
          body: createReadStream(prepared.filePath),
          contentType: prepared.contentType,
          contentLength: prepared.size,
        })
        await updateTrackStoredFile(record.id, {
          storageBackend,
          storageKey,
          filename: prepared.filename,
          contentType: prepared.contentType,
          size: prepared.size,
        })
        const oldRef = getTrackObjectRef(record)
        if (oldRef.backend !== storageBackend || oldRef.key !== storageKey) {
          await getStorageDriver(oldRef.backend).deleteObject(oldRef.key).catch((error: unknown) => {
            console.warn(`Converted ${record.id} but could not delete its FLAC original: ${error instanceof Error ? error.message : String(error)}`)
          })
        }
        migrated += 1
      }
      finally {
        await tempFile.cleanup()
      }
    }
    catch (error) {
      console.warn(`Failed to convert ${record.id} to MP4: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return migrated
}

export async function readStoredTrackBuffer(record: Track): Promise<Buffer> {
  const object = await getStoredTrack(record)
  return readReadableToBuffer(object.body)
}

export async function getStoredTrack(record: Track, range?: ByteRange): Promise<StoredObject> {
  const ref = getTrackObjectRef(record)
  return getStorageDriver(ref.backend).getObject({
    key: ref.key,
    range,
  })
}

export function isStorageObjectMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const candidate = error as {
    code?: string
    name?: string
    $metadata?: { httpStatusCode?: number }
  }
  return candidate.code === 'ENOENT'
    || candidate.code === 'NoSuchKey'
    || candidate.name === 'NoSuchKey'
    || candidate.name === 'NotFound'
    || candidate.$metadata?.httpStatusCode === 404
}
