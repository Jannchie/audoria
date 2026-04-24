import type { MusicDlSource } from '../src/musicSources.js'
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { db, tracks } from '../src/db.js'
import { searchMusicDl } from '../src/musicdl.js'
import { musicDlSources } from '../src/musicSources.js'

function normalizePart(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[()[\]{}（）【】]/g, ' ')
    .replaceAll(/[^a-z0-9\u4E00-\u9FFF]+/g, '')
}

function splitArtistTokens(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/[,/&、，；;|]| feat\. | ft\. | featuring /i)
    .map(part => normalizePart(part))
    .filter(Boolean)
}

function isMusicDlSource(value: string | null | undefined): value is MusicDlSource {
  return Boolean(value && musicDlSources.includes(value as MusicDlSource))
}

function buildSearchKeyword(track: typeof tracks.$inferSelect): string {
  const parts = [track.title, track.artists].map(value => (value ?? '').trim()).filter(Boolean)
  if (parts.length > 0) {
    return parts.join(' ')
  }
  return track.filename
}

function pickBestIdentifier(
  track: typeof tracks.$inferSelect,
  results: Awaited<ReturnType<typeof searchMusicDl>>,
): string | null {
  const normalizedTitle = normalizePart(track.title)
  const normalizedAlbum = normalizePart(track.album)
  const artistTokens = splitArtistTokens(track.artists)
  const durationSeconds = track.durationSeconds

  let possibleIdentifier: string | null = null

  for (const result of results) {
    const identifier = result.songInfo.identifier === null || result.songInfo.identifier === undefined
      ? ''
      : String(result.songInfo.identifier).trim()
    if (!identifier) {
      continue
    }

    if (normalizePart(result.display.songName) !== normalizedTitle) {
      continue
    }

    const resultArtistTokens = splitArtistTokens(result.display.singers)
    const sharesArtist = artistTokens.length > 0
      && resultArtistTokens.some(token => artistTokens.includes(token))
    if (!sharesArtist) {
      continue
    }

    const albumMatches = normalizedAlbum
      && normalizePart(result.display.album) === normalizedAlbum
    const durationMatches = durationSeconds !== null
      && result.songInfo.duration_s !== null
      && Math.abs(result.songInfo.duration_s - durationSeconds) <= 3

    if (albumMatches || durationMatches) {
      return identifier
    }

    if (!possibleIdentifier) {
      possibleIdentifier = identifier
    }
  }

  return possibleIdentifier
}

async function main(): Promise<void> {
  const pending = db
    .select()
    .from(tracks)
    .where(and(
      isNull(tracks.sourceIdentifier),
      isNotNull(tracks.source),
      isNotNull(tracks.title),
      isNotNull(tracks.artists),
      or(
        eq(tracks.source, 'NeteaseMusicClient'),
        eq(tracks.source, 'QQMusicClient'),
        eq(tracks.source, 'KuwoMusicClient'),
        eq(tracks.source, 'MiguMusicClient'),
        eq(tracks.source, 'JamendoMusicClient'),
      ),
    ))
    .all()

  if (pending.length === 0) {
    console.warn('No tracks need source identifier backfill.')
    return
  }

  console.warn(`Found ${pending.length} track(s) without source identifier. Starting backfill...`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const [index, track] of pending.entries()) {
    const label = `[${index + 1}/${pending.length}] ${track.title ?? track.filename} (${track.id})`
    try {
      if (!isMusicDlSource(track.source)) {
        console.warn(`${label}: unsupported source, skipped`)
        skipped += 1
        continue
      }

      const keyword = buildSearchKeyword(track)
      const results = await searchMusicDl(keyword, track.source, {}, 10)
      const identifier = pickBestIdentifier(track, results)

      if (!identifier) {
        console.warn(`${label}: no confident identifier match, skipped`)
        skipped += 1
        continue
      }

      db.update(tracks)
        .set({ sourceIdentifier: identifier })
        .where(eq(tracks.id, track.id))
        .run()

      console.warn(`${label}: ${track.source} -> ${identifier}`)
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
