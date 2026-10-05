import type { LyricsDoc, LyricsWord } from '@audoria/lyrics-core'
import type { RubySegment } from '../api/types.gen'
import { cueText, lyricsDocFromText, wordTimeAt } from '@audoria/lyrics-core'
import { useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'
import { getMusicByIdLyrics } from '../api/sdk.gen'
import { usePlayerState } from './usePlayerState'

export interface LyricLine {
  /** Id of the cue the line shows; keys furigana lookups and edits. */
  id: string
  /** Seconds. */
  time: number
  text: string
  words: LyricsWord[]
  /** Backing vocals sung over the line. */
  background: LyricsWord[]
  /** Every word carries its own time, so the line can be highlighted word by word. */
  wordTimed: boolean
  /** The cue's translations, in track order. */
  translations: string[]
}

/** A run of text with its own highlight time, in ms; untimed in line-timed lyrics. */
export interface LyricPiece {
  text: string
  begin?: number
  end?: number
}

/** One furigana segment of a line, cut at word boundaries so each piece can be timed. */
export interface LyricChunk {
  /** Position of `segment` among the line's furigana segments; keys reading edits. */
  index: number
  segment: RubySegment
  pieces: LyricPiece[]
  /** The time the segment's reading is highlighted over: from its first piece to its last. */
  begin?: number
  end?: number
}

export function linesFromDoc(doc: LyricsDoc | null | undefined): LyricLine[] | null {
  if (!doc || doc.timing === 'none') {
    return null
  }
  const translations = doc.tracks.filter(track => track.kind === 'translation')
  return doc.cues.map(cue => ({
    id: cue.id,
    time: (cue.begin ?? 0) / 1000,
    text: cueText(cue),
    words: cue.words,
    background: cue.background ?? [],
    wordTimed: doc.timing === 'word' && cue.words.length > 0,
    translations: translations.flatMap(track => track.lines[cue.id] ? [track.lines[cue.id]] : []),
  }))
}

/**
 * Lays a line out for display: its furigana segments (or the whole text, when there are none
 * or they no longer match the text), each cut where words begin and end, so a word cut in two
 * shares its time out by length.
 */
export function layoutLyricLine(words: LyricsWord[], segments?: RubySegment[]): LyricChunk[] {
  const text = cueText({ words })
  const usable = segments && segments.length > 0 && segments.map(segment => segment.text).join('') === text
    ? segments
    : [{ text }]

  let offset = 0
  const spans = words.map((word) => {
    const span = { word, start: offset, end: offset + word.text.length }
    offset = span.end
    return span
  })
  const timeAt = (span: typeof spans[number], position: number): number | undefined =>
    wordTimeAt(span.word, position - span.start)

  let cursor = 0
  return usable.map((segment, index) => {
    const start = cursor
    const end = cursor + segment.text.length
    cursor = end
    const pieces = spans
      .filter(span => span.start < end && span.end > start)
      .map((span) => {
        const from = Math.max(span.start, start)
        const to = Math.min(span.end, end)
        return { text: text.slice(from, to), begin: timeAt(span, from), end: timeAt(span, to) }
      })
    return { index, segment, pieces, begin: pieces[0]?.begin, end: pieces.at(-1)?.end }
  })
}

export function findLyricLineAtTime(lines: LyricLine[] | null | undefined, time: number): LyricLine | null {
  if (!lines || lines.length === 0) {
    return null
  }

  let currentLine: LyricLine | null = null
  for (const line of lines) {
    if (line.time <= time) {
      currentLine = line
      continue
    }
    return currentLine ?? line
  }

  return currentLine
}

export function lyricsDocQueryKey(trackId: string | null | undefined, lyrics: string | null | undefined) {
  return ['lyrics-doc', trackId, lyrics] as const
}

interface TrackLyrics {
  id: string
  lyrics?: string | null
  hasLyricsDoc?: boolean
}

/**
 * A track's lyrics document. Lyrics never edited in place are their `lyrics` text, read here
 * without a request; edited ones are fetched. The text is part of the query key: the API keeps
 * it in step with the document, so any edit to either refetches.
 */
export function useLyricsDoc(track: () => TrackLyrics | null | undefined) {
  const hasLyrics = computed(() => Boolean(track()?.lyrics?.trim()))
  const isEdited = computed(() => hasLyrics.value && Boolean(track()?.hasLyricsDoc))
  const parsedText = computed(() => isEdited.value ? null : lyricsDocFromText(track()?.lyrics))
  const query = useQuery({
    queryKey: computed(() => lyricsDocQueryKey(track()?.id, track()?.lyrics)),
    queryFn: async () => {
      const { data } = await getMusicByIdLyrics({ path: { id: track()!.id }, throwOnError: true })
      return data.doc
    },
    enabled: isEdited,
    // After an edit, keep showing the same track's lyrics until the new document arrives.
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === track()?.id ? previous : undefined,
    staleTime: Infinity,
  })
  return computed<LyricsDoc | null>(() => isEdited.value ? query.data.value ?? null : parsedText.value)
}

export function useLyrics(doc: () => LyricsDoc | null | undefined) {
  const { currentTime, lastSeekDelta } = usePlayerState()

  const parsed = computed(() => linesFromDoc(doc()))

  const isTimeSynced = computed(() => parsed.value !== null && parsed.value.length > 0)

  const plainText = computed(() => doc()?.cues.map(cueText).join('\n').trim() ?? '')

  // Level 2: compensate lyrics highlight for iOS seek imprecision
  const compensatedTime = computed(() => currentTime.value - lastSeekDelta.value)

  const currentLineIndex = computed(() => {
    const lines = parsed.value
    if (!lines || lines.length === 0) {
      return -1
    }
    const t = compensatedTime.value
    let idx = -1
    for (const [i, line] of lines.entries()) {
      if (line.time <= t) {
        idx = i
      }
      else {
        break
      }
    }
    return idx
  })

  return {
    parsed,
    isTimeSynced,
    plainText,
    currentLineIndex,
  }
}
