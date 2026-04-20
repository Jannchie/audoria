import { and, isNotNull } from 'drizzle-orm'
import { db, tracks } from '../src/db.js'
import {
  isStorageObjectMissingError,
  readStoredTrackCoverMaskBuffer,
  storeTrackCoverMask,
} from '../src/storage.js'

async function main(): Promise<void> {
  const pending = db
    .select()
    .from(tracks)
    .where(and(
      isNotNull(tracks.coverStorageBackend),
      isNotNull(tracks.coverStorageKey),
    ))
    .all()

  if (pending.length === 0) {
    console.warn('No tracks with covers found.')
    return
  }

  console.warn(`Found ${pending.length} track(s) with covers. Starting mask backfill...`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const [index, track] of pending.entries()) {
    const label = `[${index + 1}/${pending.length}] ${track.title ?? track.filename} (${track.id})`
    try {
      await readStoredTrackCoverMaskBuffer(track)
      console.warn(`${label}: mask exists, skipped`)
      skipped += 1
      continue
    }
    catch (error) {
      if (!isStorageObjectMissingError(error)) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.warn(`${label}: failed while checking mask - ${message}`)
        failed += 1
        continue
      }
    }

    try {
      await storeTrackCoverMask(track)
      console.warn(`${label}: mask generated`)
      updated += 1
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`${label}: failed - ${message}`)
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
