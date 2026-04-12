import type { Readable } from 'node:stream'
import type { Track } from './db.js'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { config } from './config.js'
import { db, tracks } from './db.js'

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
})

export async function storeTrack({
  filename,
  contentType,
  size,
  body,
}: {
  filename: string
  contentType: string | null
  size?: number | null
  body: Readable
}): Promise<Track> {
  const id = randomUUID()
  const key = `music/${id}-${filename || 'audio'}`
  const createdAt = Date.now()
  let resolvedSize = size ?? null
  let uploadBody: Readable = body

  if (resolvedSize === null) {
    const countingStream = new PassThrough()
    let countedBytes = 0
    countingStream.on('data', (chunk: Buffer | string) => {
      countedBytes += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk)
    })
    body.on('error', error => countingStream.destroy(error))
    body.pipe(countingStream)
    uploadBody = countingStream
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: uploadBody,
        ContentType: contentType || undefined,
      }),
    )
    resolvedSize = countedBytes
  }
  else {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: uploadBody,
        ContentType: contentType || undefined,
        ContentLength: resolvedSize,
      }),
    )
  }

  const record: Track = {
    id,
    filename: filename || 'audio',
    s3Key: key,
    coverS3Key: null,
    title: null,
    artists: null,
    album: null,
    source: null,
    durationText: null,
    durationSeconds: null,
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
  size,
  body,
}: {
  trackId: string
  contentType: string | null
  size: number
  body: Uint8Array
}): Promise<string> {
  const key = `covers/${trackId}`
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || undefined,
      ContentLength: size,
    }),
  )
  return key
}

export async function deleteStoredTrack(record: Track): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: record.s3Key,
    }),
  )
  if (record.coverS3Key) {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.s3.bucket,
        Key: record.coverS3Key,
      }),
    )
  }
}
