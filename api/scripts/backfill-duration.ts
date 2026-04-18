import type { GetObjectCommandOutput } from '@aws-sdk/client-s3'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { eq, isNull, or } from 'drizzle-orm'
import { config } from '../src/config.js'
import { db, tracks } from '../src/db.js'
import { formatDurationText, probeDurationSeconds } from '../src/probeAudio.js'

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

async function bodyToBuffer(body: GetObjectCommandOutput['Body']): Promise<Buffer> {
  if (!body) {
    throw new Error('Missing object body')
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body)
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = []
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
    }
    return Buffer.concat(chunks)
  }
  if ('transformToByteArray' in body && typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray()
    return Buffer.from(bytes)
  }
  throw new TypeError('Unsupported S3 body type')
}

async function main(): Promise<void> {
  const pending = db
    .select()
    .from(tracks)
    .where(or(isNull(tracks.durationSeconds), isNull(tracks.durationText)))
    .all()

  if (pending.length === 0) {
    console.warn('No tracks need backfill.')
    return
  }

  console.warn(`Found ${pending.length} track(s) without duration. Starting backfill...`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const [index, track] of pending.entries()) {
    const label = `[${index + 1}/${pending.length}] ${track.title ?? track.filename} (${track.id})`
    try {
      const object = await s3Client.send(
        new GetObjectCommand({ Bucket: config.s3.bucket, Key: track.s3Key }),
      )
      const buffer = await bodyToBuffer(object.Body)
      const durationSeconds = await probeDurationSeconds(buffer, track.contentType)
      if (durationSeconds === null) {
        console.warn(`${label}: duration unavailable, skipped`)
        skipped += 1
        continue
      }
      const durationText = formatDurationText(durationSeconds)
      db.update(tracks)
        .set({ durationSeconds, durationText })
        .where(eq(tracks.id, track.id))
        .run()
      console.warn(`${label}: ${durationText} (${durationSeconds}s)`)
      updated += 1
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`${label}: failed — ${message}`)
      failed += 1
    }
  }

  console.warn(`Done. updated=${updated} skipped=${skipped} failed=${failed}`)
}

try {
  await main()
}
catch (error) {
  console.error(error)
  process.exitCode = 1
}
