import type { LyricsDoc } from '@audoria/lyrics-core'
import type { Track } from '../db/schema.js'
import { looksLikeTtml, lyricsDocFromText, lyricsDocFromTtml, lyricsDocToText } from '@audoria/lyrics-core'

// How a track's lyrics live in its two columns. `lyrics_doc` is the source of truth once set,
// with `lyrics` holding its LRC rendering; while it is null, the document is read from the
// `lyrics` text. Every write goes through here so the two never drift apart.

export interface LyricsColumns {
  lyrics: string | null
  lyricsDoc: string | null
}

export function readLyricsDoc(row: Pick<Track, 'lyrics' | 'lyricsDoc'>): LyricsDoc | null {
  return row.lyricsDoc ? JSON.parse(row.lyricsDoc) as LyricsDoc : lyricsDocFromText(row.lyrics)
}

/** Stores a document with its LRC rendering; one that renders to nothing clears the lyrics. */
export function lyricsColumnsFromDoc(doc: LyricsDoc | null): LyricsColumns {
  const text = doc ? lyricsDocToText(doc) : ''
  return text.trim() ? { lyrics: text, lyricsDoc: JSON.stringify(doc) } : { lyrics: null, lyricsDoc: null }
}

/**
 * Stores lyrics given as text. TTML can carry more than LRC, so it is kept as a document; LRC
 * and plain text are stored as written. Throws TtmlParseError on malformed TTML.
 */
export function lyricsColumnsFromText(raw: string | null): LyricsColumns {
  if (raw && looksLikeTtml(raw)) {
    return lyricsColumnsFromDoc(lyricsDocFromTtml(raw))
  }
  return { lyrics: raw, lyricsDoc: null }
}
