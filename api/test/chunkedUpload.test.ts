import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { env } from 'node:process'
import { Readable } from 'node:stream'
// The api package has no vitest dependency; it runs on the built-in runner.
// eslint-disable-next-line test/no-import-node-test
import { before, describe, it } from 'node:test'
import {
  abortUploadSession,
  completeUploadSession,
  createUploadSession,
  UPLOAD_CHUNK_SIZE,
  UploadSessionError,
  writeUploadChunk,
} from '../src/chunkedUpload.js'
import { initSqlite } from '../src/db/sqlite.js'

function chunkOf(data: Buffer, index: number): Readable {
  return Readable.from([data.subarray(index * UPLOAD_CHUNK_SIZE, (index + 1) * UPLOAD_CHUNK_SIZE)])
}

async function assertUploadError(promise: Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof UploadSessionError && error.status === status)
}

describe('chunked upload', () => {
  before(() => {
    initSqlite(path.join(mkdtempSync(path.join(tmpdir(), 'audoria-chunked-test-')), 'test.sqlite'))
  })

  it('assembles chunks sent out of order and retried into the stored track', async () => {
    const data = randomBytes(UPLOAD_CHUNK_SIZE + 1234)
    const { id, chunkCount } = await createUploadSession({ filename: 'song.bin', contentType: null, size: data.byteLength })
    assert.equal(chunkCount, 2)

    await writeUploadChunk(id, 1, chunkOf(data, 1))
    await assertUploadError(completeUploadSession(id), 409)
    await writeUploadChunk(id, 0, Readable.from([randomBytes(UPLOAD_CHUNK_SIZE)]))
    await writeUploadChunk(id, 0, chunkOf(data, 0))

    const record = await completeUploadSession(id)
    assert.equal(record.size, data.byteLength)
    const stored = readFileSync(path.join(env.STORAGE_FS_ROOT!, record.storageKey))
    assert.ok(stored.equals(data))
    await assertUploadError(completeUploadSession(id), 404)
  })

  it('rejects chunks of the wrong length and keeps them unreceived', async () => {
    const { id } = await createUploadSession({ filename: 'short.bin', contentType: null, size: 10 })
    await assertUploadError(writeUploadChunk(id, 0, Readable.from([Buffer.alloc(11)])), 400)
    await assertUploadError(writeUploadChunk(id, 0, Readable.from([Buffer.alloc(9)])), 400)
    await assertUploadError(writeUploadChunk(id, 1, Readable.from([Buffer.alloc(10)])), 400)
    await assertUploadError(completeUploadSession(id), 409)
    await abortUploadSession(id)
    await assertUploadError(writeUploadChunk(id, 0, Readable.from([Buffer.alloc(10)])), 404)
  })

  it('rejects empty files', async () => {
    await assertUploadError(createUploadSession({ filename: 'empty.bin', contentType: null, size: 0 }), 400)
  })
})
