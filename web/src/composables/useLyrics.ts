import type { LyricChunk as CoreLyricChunk, LyricsDoc, LyricsWord } from '@audoria/lyrics-core'
import type { RubySegment } from '../api/types.gen'
import { cueText, isWordTimedCue, layoutLine, lyricsDocFromText, settleBreaks } from '@audoria/lyrics-core'
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

export function linesFromDoc(source: LyricsDoc | null | undefined): LyricLine[] | null {
  if (!source || source.timing === 'none') {
    return null
  }
  // Documents saved before blanks were settled can still have one cutting a line short.
  const doc = settleBreaks(source)
  const translations = doc.tracks.filter(track => track.kind === 'translation')
  return doc.cues.map(cue => ({
    id: cue.id,
    time: (cue.begin ?? 0) / 1000,
    text: cueText(cue),
    words: cue.words,
    background: cue.background ?? [],
    wordTimed: doc.timing === 'word' && isWordTimedCue(cue),
    translations: translations.flatMap(track => track.lines[cue.id] ? [track.lines[cue.id]] : []),
  }))
}

export type LyricChunk = CoreLyricChunk<RubySegment | { text: string, ruby?: undefined, explicit?: undefined }>

/** Lays a line out for display with its furigana; see `layoutLine`. */
export function layoutLyricLine(words: LyricsWord[], segments?: RubySegment[]): LyricChunk[] {
  return layoutLine(words, segments)
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
