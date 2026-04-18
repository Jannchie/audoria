import type { Readable } from 'node:stream'
import type { Track } from './db.js'
import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { config } from './config.js'
import { db, tracks } from './db.js'
import { formatDurationText, probeDurationSeconds } from './probeAudio.js'

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
  const key = `music/${id}-${filename || 'audio'}`
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

  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || undefined,
      ContentLength: resolvedSize,
    }),
  )
  onProgress?.(resolvedSize)

  const record: Track = {
    id,
    filename: filename || 'audio',
    s3Key: key,
    coverS3Key: null,
    title: null,
    artists: null,
    album: null,
    source: null,
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

export async function deleteTrackCover(coverS3Key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: coverS3Key,
    }),
  )
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
