import type { Track } from '../src/db/index.js'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { __db as db, tracks } from '../src/db/index.js'
import { initRuntimeDb } from '../src/db/runtime.js'
import { createCoverThumbhash, readStoredTrackCoverBuffer } from '../src/storage.js'

async function main(): Promise<void> {
  const pending: Track[] = await db
    .select()
    .from(tracks)
    .where(and(
      isNotNull(tracks.coverStorageBackend),
      isNotNull(tracks.coverStorageKey),
      isNull(tracks.coverThumbhash),
    ))
    .all()

  if (pending.length === 0) {
    console.warn('No tracks need cover ThumbHash backfill.')
    return
  }

  console.warn(`Found ${pending.length} track(s). Starting cover ThumbHash backfill...`)

  let updated = 0
  let failed = 0

  for (const [index, track] of pending.entries()) {
    const label = `[${index + 1}/${pending.length}] ${track.title ?? track.filename} (${track.id})`
    try {
      const coverBody = await readStoredTrackCoverBuffer(track)
      const coverThumbhash = await createCoverThumbhash(coverBody)
      await db.update(tracks)
        .set({ coverThumbhash })
        .where(eq(tracks.id, track.id))
        .run()
      console.warn(`${label}: generated`)
      updated += 1
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`${label}: failed - ${message}`)
      failed += 1
    }
  }

  console.warn(`Done. updated=${updated} failed=${failed}`)
}

try {
  initRuntimeDb()
  await main()
}
catch (error) {
  console.error(error)
  process.exitCode = 1
}
