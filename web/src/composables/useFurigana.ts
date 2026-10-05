import type { LyricsDoc, LyricsRuby } from '@audoria/lyrics-core'
import type { RubySegment } from '../api/types.gen'
import { cueText } from '@audoria/lyrics-core'
import { useQuery } from '@tanstack/vue-query'
import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'
import { getMusicByIdLyricsFurigana } from '../api/sdk.gen'

const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u

/**
 * Sets a hand-set reading on segment `index` of cue `cueId`, and on every other cue with the same
 * text and readings (a repeated chorus). An empty reading drops it and returns the word to the
 * analyzer.
 */
export function applyReadingCorrection(
  doc: LyricsDoc,
  cueId: string,
  segments: RubySegment[],
  index: number,
  reading: string,
): LyricsDoc {
  const target = doc.cues.find(cue => cue.id === cueId)
  if (!target || !segments[index]) {
    return doc
  }
  const start = segments.slice(0, index).reduce((length, segment) => length + segment.text.length, 0)
  const end = start + segments[index].text.length
  const trimmed = reading.trim()
  const targetText = cueText(target)
  const targetRuby = JSON.stringify(target.ruby ?? [])
  const ruby: LyricsRuby[] = [
    ...(target.ruby ?? []).filter(range => range.end <= start || range.start >= end),
    ...(trimmed ? [{ start, end, reading: trimmed }] : []),
  ].sort((a, b) => a.start - b.start)
  if (JSON.stringify(ruby) === targetRuby) {
    return doc
  }

  return {
    ...doc,
    cues: doc.cues.map((cue) => {
      if (cueText(cue) !== targetText || JSON.stringify(cue.ruby ?? []) !== targetRuby) {
        return cue
      }
      const { ruby: _previous, ...rest } = cue
      return ruby.length > 0 ? { ...rest, ruby } : rest
    }),
  }
}

export function useFurigana(trackId: () => string | null | undefined, lyrics: () => string | null | undefined) {
  // On by default: Japanese lyrics get readings unless the listener turns them off.
  const enabled = useLocalStorage('audoria:lyrics-furigana', true)

  const hasJapanese = computed(() => KANA_RE.test(lyrics() ?? ''))

  const query = useQuery({
    queryKey: computed(() => ['lyrics-furigana', trackId(), lyrics()] as const),
    queryFn: async () => {
      const { data } = await getMusicByIdLyricsFurigana({ path: { id: trackId()! }, throwOnError: true })
      return data.lines
    },
    enabled: computed(() => enabled.value && hasJapanese.value && Boolean(trackId())),
    // After an edit, keep the same track's readings on screen until the new ones arrive.
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === trackId() ? previous : undefined,
    staleTime: Infinity,
  })

  // Keyed by cue id.
  const segmentsByCue = computed<Record<string, RubySegment[]>>(() =>
    enabled.value && hasJapanese.value ? query.data.value ?? {} : {})

  return {
    enabled,
    hasJapanese,
    segmentsByCue,
    isLoading: computed(() => query.isFetching.value),
  }
}

export { type RubySegment } from '../api/types.gen'
