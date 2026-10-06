import type { LyricsWord } from './doc.js'
import { cueText, hasTimedSyllables, syllableEnd, wordTimeAt } from './doc.js'

/** A run of a line's text with its own highlight time, in ms; untimed in line-timed lyrics. */
export interface LyricPiece {
  text: string
  begin?: number
  end?: number
}

/** One reading segment of a line, cut at word boundaries so each piece can be timed. */
export interface LyricChunk<Segment extends { text: string } = { text: string, ruby?: string }> {
  /** Position of `segment` among the line's segments. */
  index: number
  segment: Segment
  pieces: LyricPiece[]
  /** The time the segment's reading is highlighted over: from its first piece to its last. */
  begin?: number
  end?: number
  /** The reading cut into the beats it was timed in, when the segment is one word timed so. */
  rubyPieces?: LyricPiece[]
}

/**
 * Lays a line out for display: its reading segments (furigana runs, or the whole text when
 * there are none or they no longer match the text), each cut where words begin and end, so a
 * word cut in two shares its time out by length.
 */
export function layoutLine<Segment extends { text: string }>(words: LyricsWord[], segments?: Segment[]): Array<LyricChunk<Segment | { text: string }>> {
  const text = cueText({ words })
  const usable: Array<Segment | { text: string }> = segments && segments.length > 0 && segments.map(segment => segment.text).join('') === text
    ? segments
    : [{ text }]

  let offset = 0
  const spans = words.map((word) => {
    const span = { word, start: offset, end: offset + word.text.length }
    offset = span.end
    return span
  })

  let cursor = 0
  return usable.map((segment, index) => {
    const start = cursor
    const end = cursor + segment.text.length
    cursor = end
    const inside = spans.filter(span => span.start < end && span.end > start)
    const pieces = inside.flatMap((span) => {
      const from = Math.max(span.start, start)
      const to = Math.min(span.end, end)
      // Beat by beat, every character gets its own share of the beats.
      const cuts = hasTimedSyllables(span.word)
        ? Array.from({ length: to - from + 1 }, (_, i) => from + i)
        : [from, to]
      return cuts.slice(0, -1).map((at, i) => ({
        text: text.slice(at, cuts[i + 1]),
        begin: wordTimeAt(span.word, at - span.start),
        end: wordTimeAt(span.word, cuts[i + 1] - span.start),
      }))
    })
    const only = inside.length === 1 && inside[0].start === start && inside[0].end === end ? inside[0].word : undefined
    const reading = 'ruby' in segment ? segment.ruby : undefined
    const rubyPieces = only && hasTimedSyllables(only) && reading === only.syllables!.map(syllable => syllable.text).join('')
      ? only.syllables!.map((syllable, i) => ({ text: syllable.text, begin: syllable.begin, end: syllableEnd(only, i) }))
      : undefined
    return { index, segment, pieces, begin: pieces[0]?.begin, end: pieces.at(-1)?.end, ...(rubyPieces ? { rubyPieces } : {}) }
  })
}
