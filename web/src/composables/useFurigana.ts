import type { RubySegment } from '../api/types.gen'
import { useQuery } from '@tanstack/vue-query'
import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'
import { getMusicByIdLyricsFurigana } from '../api/sdk.gen'

const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const LRC_TAGS_RE = /^(?:\[[^\]]*\])+/

function formatSegment(segment: RubySegment): string {
  return segment.explicit && segment.ruby ? `${segment.text}(${segment.ruby})` : segment.text
}

/**
 * Rewrites every lyric line whose text is `lineSource` so that segment `index` carries a hand-set
 * reading, written as `漢字(よみ)`. An empty reading drops the notation and returns the word to the
 * analyzer. Other hand-set readings on the line are kept; analyzed ones are not written out.
 */
export function applyReadingCorrection(
  lyrics: string,
  lineSource: string,
  segments: RubySegment[],
  index: number,
  reading: string,
): string {
  const nextSource = segments
    .map((segment, i) => {
      if (i !== index) {
        return formatSegment(segment)
      }
      const trimmed = reading.trim()
      return trimmed ? `${segment.text}(${trimmed})` : segment.text
    })
    .join('')

  return lyrics
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      const tags = LRC_TAGS_RE.exec(trimmed)?.[0] ?? ''
      return trimmed.slice(tags.length).trim() === lineSource ? `${tags}${nextSource}` : line
    })
    .join('\n')
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
    staleTime: Infinity,
  })

  const segmentsByLine = computed<Record<string, RubySegment[]>>(() =>
    enabled.value && hasJapanese.value ? query.data.value ?? {} : {})

  return {
    enabled,
    hasJapanese,
    segmentsByLine,
    isLoading: computed(() => query.isFetching.value),
  }
}

export { type RubySegment } from '../api/types.gen'
