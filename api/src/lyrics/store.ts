import type { LyricsDoc } from '@audoria/lyrics-core'
import type { Track } from '../db/schema.js'
import type { MusicDlSongInfo } from '../musicdl.js'
import { isLrcFormat, looksLikeTtml, lrcFromNetease, lyricsDocFromText, lyricsDocFromTtml, lyricsDocFromYrc, lyricsDocToText, mergeLyricsText } from '@audoria/lyrics-core'

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

/**
 * Stores lyrics edited as text over what a track has. LRC merged into an existing document keeps
 * the word timing of every line whose text is unchanged; TTML and plain text replace it.
 */
export function lyricsColumnsFromEdit(raw: string | null, row: Pick<Track, 'lyrics' | 'lyricsDoc'>): LyricsColumns {
  if (raw && row.lyricsDoc && isLrcFormat(raw) && !looksLikeTtml(raw)) {
    const incoming = lyricsDocFromText(raw)
    if (incoming) {
      return lyricsColumnsFromDoc(mergeLyricsText(JSON.parse(row.lyricsDoc) as LyricsDoc, incoming))
    }
  }
  return lyricsColumnsFromText(raw)
}

/** Lyrics text a source really has: sources write 'NULL' for what they couldn't read. */
function present(value: string | null | undefined): string | undefined {
  return value?.trim() && value.trim() !== 'NULL' ? value : undefined
}

/**
 * Source lyrics replace the track's own; without any, whatever the track has is kept as is.
 * Word-timed lyrics (NetEase YRC) are taken over plain ones, and a translation goes along.
 */
export function lyricsColumnsFromSource(songInfo: Pick<MusicDlSongInfo, 'lyric' | 'word_lyric' | 'translated_lyric'>, track: Pick<Track, 'lyrics' | 'lyricsDoc'>): LyricsColumns {
  const lyric = present(songInfo.lyric)
  const translation = present(songInfo.translated_lyric)
  const wordLyric = present(songInfo.word_lyric)
  const wordTimed = wordLyric ? lyricsDocFromYrc(wordLyric, { lrc: lyric, translation }) : null
  if (wordTimed) {
    return lyricsColumnsFromDoc(wordTimed)
  }
  if (!lyric) {
    return { lyrics: track.lyrics, lyricsDoc: track.lyricsDoc }
  }
  try {
    return lyricsColumnsFromText(looksLikeTtml(lyric) ? lyric : lrcFromNetease(lyric, translation))
  }
  catch {
    // Malformed TTML from a source is still worth keeping as text.
    return { lyrics: lyric, lyricsDoc: null }
  }
}
