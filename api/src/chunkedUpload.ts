import type { Readable } from 'node:stream'
import type { Track } from './db/schema.js'
import { randomUUID } from 'node:crypto'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { storeTrackFile } from './storage.js'

// Cloudflare rejects request bodies over 100 MB, so large files arrive as
// chunks that are written into one temp file and stored once complete.
export const UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024
export const MAX_UPLOAD_SIZE = 4 * 1024 * 1024 * 1024
const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000

export class UploadSessionError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 413) {
    super(message)
  }
}

interface UploadSession {
  id: string
  filename: string
  contentType: string | null
  size: number
  chunkCount: number
  received: Set<number>
  directory: string
  filePath: string
  touchedAt: number
}

const sessions = new Map<string, UploadSession>()

async function removeSession(session: UploadSession): Promise<void> {
  sessions.delete(session.id)
  await rm(session.directory, { recursive: true, force: true }).catch(() => {})
}

async function pruneExpiredUploadSessions(now = Date.now()): Promise<void> {
  const expired = [...sessions.values()].filter(session => now - session.touchedAt > UPLOAD_SESSION_TTL_MS)
  await Promise.all(expired.map(removeSession))
}

function getSession(id: string): UploadSession {
  const session = sessions.get(id)
  if (!session) {
    throw new UploadSessionError('Upload session not found', 404)
  }
  session.touchedAt = Date.now()
  return session
}

export async function createUploadSession({
  filename,
  contentType,
  size,
}: {
  filename: string
  contentType: string | null
  size: number
}): Promise<{ id: string, chunkSize: number, chunkCount: number }> {
  await pruneExpiredUploadSessions()
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new UploadSessionError('File size must be a positive integer', 400)
  }
  if (size > MAX_UPLOAD_SIZE) {
    throw new UploadSessionError(`File is larger than ${MAX_UPLOAD_SIZE} bytes`, 413)
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'audoria-chunked-'))
  const filePath = path.join(directory, 'track.bin')
  const handle = await open(filePath, 'w')
  await handle.close()

  const session: UploadSession = {
    id: randomUUID(),
    filename: filename || 'audio',
    contentType,
    size,
    chunkCount: Math.ceil(size / UPLOAD_CHUNK_SIZE),
    received: new Set(),
    directory,
    filePath,
    touchedAt: Date.now(),
  }
  sessions.set(session.id, session)
  return { id: session.id, chunkSize: UPLOAD_CHUNK_SIZE, chunkCount: session.chunkCount }
}

/**
 * Writes chunk `index` at its offset, so a retried chunk simply overwrites the
 * same bytes. The body must be exactly the chunk's expected length.
 */
export async function writeUploadChunk(id: string, index: number, body: Readable): Promise<void> {
  const session = getSession(id)
  if (!Number.isInteger(index) || index < 0 || index >= session.chunkCount) {
    throw new UploadSessionError(`Chunk index must be between 0 and ${session.chunkCount - 1}`, 400)
  }
  const offset = index * UPLOAD_CHUNK_SIZE
  const expectedLength = Math.min(UPLOAD_CHUNK_SIZE, session.size - offset)

  session.received.delete(index)
  const handle = await open(session.filePath, 'r+')
  let written = 0
  try {
    for await (const rawChunk of body) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array)
      if (written + chunk.byteLength > expectedLength) {
        throw new UploadSessionError(`Chunk ${index} is longer than ${expectedLength} bytes`, 400)
      }
      await handle.write(chunk, 0, chunk.byteLength, offset + written)
      written += chunk.byteLength
    }
  }
  finally {
    await handle.close()
  }
  if (written !== expectedLength) {
    throw new UploadSessionError(`Chunk ${index} has ${written} bytes, expected ${expectedLength}`, 400)
  }
  session.received.add(index)
}

export async function completeUploadSession(id: string): Promise<Track> {
  const session = getSession(id)
  if (session.received.size !== session.chunkCount) {
    const missing = Array.from({ length: session.chunkCount }, (_, index) => index)
      .filter(index => !session.received.has(index))
    throw new UploadSessionError(`Missing chunks: ${missing.join(', ')}`, 409)
  }
  // Drop the session first so a duplicate complete cannot store the file twice.
  sessions.delete(session.id)
  try {
    return await storeTrackFile({
      filePath: session.filePath,
      filename: session.filename,
      contentType: session.contentType,
    })
  }
  finally {
    await removeSession(session)
  }
}

export async function abortUploadSession(id: string): Promise<void> {
  const session = sessions.get(id)
  if (session) {
    await removeSession(session)
  }
}
