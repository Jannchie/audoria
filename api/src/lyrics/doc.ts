import { z } from '@hono/zod-openapi'

// Times are integer milliseconds; text offsets are UTF-16 code units into the cue's text,
// i.e. the concatenation of its words.

export const LyricsWordSchema = z.object({
  text: z.string().max(1000),
  begin: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
}).openapi('LyricsWord')

export const LyricsRubySchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  reading: z.string().min(1).max(200),
}).openapi('LyricsRuby', { description: 'A hand-set reading over cue text [start, end); unset ranges are read by the analyzer' })

export const LyricsCueSchema = z.object({
  id: z.string().min(1).max(64),
  begin: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
  agent: z.string().max(64).optional().openapi({ description: 'Singer for duets, as TTML ttm:agent (v1, v2, …)' }),
  words: z.array(LyricsWordSchema).max(500),
  background: z.array(LyricsWordSchema).max(500).optional().openapi({ description: 'Backing vocals sung over this cue' }),
  ruby: z.array(LyricsRubySchema).max(500).optional(),
}).openapi('LyricsCue')

export const LyricsTrackSchema = z.object({
  lang: z.string().min(1).max(35),
  kind: z.enum(['translation', 'transliteration']),
  lines: z.record(z.string(), z.string().max(1000)).openapi({ description: 'Text keyed by cue id' }),
}).openapi('LyricsTrack')

export const LyricsDocSchema = z.object({
  version: z.literal(1),
  timing: z.enum(['none', 'line', 'word']),
  lang: z.string().min(1).max(35).optional(),
  cues: z.array(LyricsCueSchema).max(5000),
  tracks: z.array(LyricsTrackSchema).max(20),
}).openapi('LyricsDoc')

export type LyricsWord = z.infer<typeof LyricsWordSchema>
export type LyricsRuby = z.infer<typeof LyricsRubySchema>
export type LyricsCue = z.infer<typeof LyricsCueSchema>
export type LyricsTrack = z.infer<typeof LyricsTrackSchema>
export type LyricsDoc = z.infer<typeof LyricsDocSchema>

export function cueText(cue: Pick<LyricsCue, 'words'>): string {
  return cue.words.map(word => word.text).join('')
}

export function sortedRuby(cue: Pick<LyricsCue, 'ruby'>): LyricsRuby[] {
  return [...cue.ruby ?? []].sort((a, b) => a.start - b.start)
}

/** Cuts a cue's text into runs: plain text between readings, and each reading over its text. */
export function rubyRuns(cue: Pick<LyricsCue, 'words' | 'ruby'>): Array<{ text: string, reading?: string }> {
  const text = cueText(cue)
  const runs: Array<{ text: string, reading?: string }> = []
  let cursor = 0
  for (const range of sortedRuby(cue)) {
    if (range.start > cursor) {
      runs.push({ text: text.slice(cursor, range.start) })
    }
    runs.push({ text: text.slice(range.start, range.end), reading: range.reading })
    cursor = range.end
  }
  if (cursor < text.length) {
    runs.push({ text: text.slice(cursor) })
  }
  return runs
}

const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const HANGUL_RE = /\p{Script=Hangul}/u
const HAN_RE = /\p{Script=Han}/u

/** Guesses the language of some lyric text from its script; undefined when it can't tell. */
export function detectLang(texts: string[]): string | undefined {
  const joined = texts.join('')
  if (KANA_RE.test(joined)) {
    return 'ja'
  }
  if (HANGUL_RE.test(joined)) {
    return 'ko'
  }
  if (HAN_RE.test(joined)) {
    return 'zh'
  }
  return undefined
}

/**
 * Checks what the schema can't: unique cue ids, timings that fit their timing mode, and ruby
 * ranges that stay inside the text, don't overlap, and never cut a word in two. A reading
 * either sits inside one word or spans whole words, so highlighting can follow word timing.
 * Returns the first problem found, or null.
 */
export function validateLyricsDoc(doc: LyricsDoc): string | null {
  const ids = new Set<string>()
  for (const cue of doc.cues) {
    if (ids.has(cue.id)) {
      return `Duplicate cue id ${cue.id}`
    }
    ids.add(cue.id)

    if (doc.timing !== 'none' && cue.begin === undefined) {
      return `Cue ${cue.id} has no begin time`
    }
    if (cue.begin !== undefined && cue.end !== undefined && cue.end < cue.begin) {
      return `Cue ${cue.id} ends before it begins`
    }
    for (const word of [...cue.words, ...cue.background ?? []]) {
      if (doc.timing === 'word' && (word.begin === undefined || word.end === undefined)) {
        return `Cue ${cue.id} has a word without timing`
      }
      if (word.begin !== undefined && word.end !== undefined && word.end < word.begin) {
        return `Cue ${cue.id} has a word that ends before it begins`
      }
    }

    // Where each word ends in the cue's text; the last is the text's length.
    const wordEnds: number[] = []
    for (const word of cue.words) {
      wordEnds.push((wordEnds.at(-1) ?? 0) + word.text.length)
    }
    const length = wordEnds.at(-1) ?? 0
    const ruby = sortedRuby(cue)
    for (const [index, range] of ruby.entries()) {
      if (range.start >= range.end || range.end > length) {
        return `Cue ${cue.id} has a reading outside its text`
      }
      if (index > 0 && range.start < ruby[index - 1].end) {
        return `Cue ${cue.id} has overlapping readings`
      }
      const insideOneWord = wordEnds.findIndex(end => range.start < end) === wordEnds.findIndex(end => range.end - 1 < end)
      const onBoundaries = (range.start === 0 || wordEnds.includes(range.start)) && wordEnds.includes(range.end)
      if (!insideOneWord && !onBoundaries) {
        return `Cue ${cue.id} has a reading that splits a word`
      }
    }
  }

  for (const track of doc.tracks) {
    for (const cueId of Object.keys(track.lines)) {
      if (!ids.has(cueId)) {
        return `Track ${track.lang} refers to unknown cue ${cueId}`
      }
    }
  }
  return null
}
