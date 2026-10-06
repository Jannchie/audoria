import type { Track } from '../src/db/schema.js'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { env } from 'node:process'
// The api package has no vitest dependency; it runs on the built-in runner.
// eslint-disable-next-line test/no-import-node-test
import { before, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { __db as db, getTrackById } from '../src/db/index.js'
import { tracks } from '../src/db/schema.js'
import { initSqlite } from '../src/db/sqlite.js'
import { api, config } from '../src/routes.js'

function insertTrack(): Track {
  const id = randomUUID()
  const record: Track = {
    id,
    filename: `${id}.mp3`,
    storageBackend: 'fs',
    storageKey: `music/${id}.mp3`,
    coverStorageBackend: null,
    coverStorageKey: null,
    coverContentType: null,
    coverThumbStorageBackend: null,
    coverThumbStorageKey: null,
    coverThumbContentType: null,
    coverThumbhash: null,
    coverMaskRequestedAt: null,
    title: id,
    artists: null,
    album: null,
    source: null,
    sourceIdentifier: null,
    durationText: null,
    durationSeconds: null,
    size: 1,
    contentType: 'audio/mpeg',
    lyrics: null,
    lyricsDoc: null,
    vocalsStorageBackend: null,
    vocalsStorageKey: null,
    vocalsUpdatedAt: null,
    sortOrder: null,
    playCount: 0,
    skipCount: 0,
    listenedSeconds: 0,
    lastPlayedAt: null,
    createdAt: Date.now(),
  }
  db.insert(tracks).values(record).run()
  return record
}

function vocalsPath(id: string): string {
  return path.join(env.STORAGE_FS_ROOT!, 'vocals', id, 'analysis.bin')
}

function putVocals(id: string, body: Uint8Array) {
  return api.request(`/music/${id}/vocals`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  })
}

async function statusOf(url: string, init?: RequestInit): Promise<number> {
  const response = await api.request(url, init)
  return response.status
}

async function storedKey(id: string): Promise<string | null | undefined> {
  const record = await getTrackById(id)
  return record?.vocalsStorageKey
}

describe('vocal analysis', () => {
  before(() => {
    initSqlite(path.join(mkdtempSync(path.join(tmpdir(), 'audoria-vocals-test-')), 'test.sqlite'))
    // A developer's .env may enable login; these requests carry no session.
    config.secretKey = null
  })

  it('is 404 before upload and round-trips the stored bytes', async () => {
    const { id } = insertTrack()
    assert.equal(await statusOf(`/music/${id}/vocals`), 404)
    assert.equal(await statusOf(`/music/missing/vocals`), 404)

    const data = randomBytes(300_000)
    const put = await putVocals(id, data)
    assert.equal(put.status, 200)
    const music = await put.json() as { hasVocals: boolean }
    assert.equal(music.hasVocals, true)

    const get = await api.request(`/music/${id}/vocals`)
    assert.equal(get.status, 200)
    assert.equal(get.headers.get('content-type'), 'application/octet-stream')
    assert.ok(Buffer.from(await get.arrayBuffer()).equals(data))

    const etag = get.headers.get('etag')
    assert.ok(etag)
    assert.equal(await statusOf(`/music/${id}/vocals`, { headers: { 'If-None-Match': etag } }), 304)
  })

  it('replaces a previous upload', async () => {
    const { id } = insertTrack()
    await putVocals(id, randomBytes(10))
    const next = randomBytes(20)
    const put = await putVocals(id, next)
    assert.equal(put.status, 200)
    const get = await api.request(`/music/${id}/vocals`)
    assert.ok(Buffer.from(await get.arrayBuffer()).equals(next))
  })

  it('rejects empty and oversized bodies, keeping what was stored', async () => {
    const { id } = insertTrack()
    const empty = await putVocals(id, new Uint8Array(0))
    assert.equal(empty.status, 400)
    const oversized = await putVocals(id, new Uint8Array(8 * 1024 * 1024 + 1))
    assert.equal(oversized.status, 413)
    assert.equal(await storedKey(id), null)

    // No Content-Length, so the limit has to be enforced while reading.
    const streamed = await api.request(`/music/${id}/vocals`, {
      method: 'PUT',
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < 9; i += 1) {
            controller.enqueue(new Uint8Array(1024 * 1024))
          }
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    assert.equal(streamed.status, 413)
    assert.equal(existsSync(vocalsPath(id)), false)
  })

  it('deletes the analysis', async () => {
    const { id } = insertTrack()
    await putVocals(id, randomBytes(10))
    const res = await api.request(`/music/${id}/vocals`, { method: 'DELETE' })
    assert.equal(res.status, 204)
    assert.equal(await statusOf(`/music/${id}/vocals`), 404)
    assert.equal(existsSync(vocalsPath(id)), false)
    assert.equal(await storedKey(id), null)
    assert.equal(await statusOf(`/music/${id}/vocals`, { method: 'DELETE' }), 204)
  })

  it('is removed with its track', async () => {
    const { id } = insertTrack()
    await putVocals(id, randomBytes(10))
    assert.equal(existsSync(vocalsPath(id)), true)
    assert.equal(await statusOf(`/music/${id}`, { method: 'DELETE' }), 204)
    assert.equal(existsSync(vocalsPath(id)), false)
  })
})

describe('sqlite bootstrap', () => {
  it('adds the vocals columns to an existing tracks table', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'audoria-upgrade-')), 'old.sqlite')
    const legacy = new Database(file)
    legacy.exec(`CREATE TABLE tracks (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, storage_backend TEXT NOT NULL, storage_key TEXT NOT NULL,
      size INTEGER NOT NULL, content_type TEXT, created_at INTEGER NOT NULL
    );`)
    legacy.close()

    initSqlite(file)
    const columns = new Database(file).prepare('PRAGMA table_info(tracks)').all() as Array<{ name: string }>
    const names = new Set(columns.map(column => column.name))
    for (const name of ['vocals_storage_backend', 'vocals_storage_key', 'vocals_updated_at']) {
      assert.ok(names.has(name), name)
    }
  })
})
