import { eq, isNull, lt, or } from 'drizzle-orm'
import { db, tracks } from '../src/db.js'
import { formatDurationText, probeDurationSeconds } from '../src/probeAudio.js'
import { readStoredTrackBuffer } from '../src/storage.js'

// Tracks shorter than 10s are almost always a mis-probed file; re-probe them.
const SUSPICIOUS_DURATION_THRESHOLD_SECONDS = 10

async function main(): Promise<void> {
  const pending = db
    .select()
    .from(tracks)
    .where(or(
      isNull(tracks.durationSeconds),
      isNull(tracks.durationText),
      lt(tracks.durationSeconds, SUSPICIOUS_DURATION_THRESHOLD_SECONDS),
    ))
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
      const buffer = await readStoredTrackBuffer(track)
      const durationSeconds = await probeDurationSeconds(buffer)
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
