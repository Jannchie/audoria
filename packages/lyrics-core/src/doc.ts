// The lyrics document: what Audoria stores, edits and plays. Times are integer milliseconds;
// text offsets are UTF-16 code units into the cue's text, i.e. the concatenation of its words.

/** One beat of a word sung over several, like a mora of a kanji's reading: こ of 心(こころ). */
export interface LyricsSyllable {
  text: string
  begin?: number
  end?: number
}

export interface LyricsWord {
  text: string
  begin?: number
  end?: number
  /**
   * The beats a word is sung in, when timed one by one, such as the morae of its reading. The
   * word spans them: it begins with the first and ends with the last.
   */
  syllables?: LyricsSyllable[]
}

/** A hand-set reading over cue text [start, end); unset ranges are left to an analyzer. */
export interface LyricsRuby {
  start: number
  end: number
  reading: string
}

export interface LyricsCue {
  id: string
  begin?: number
  end?: number
  /** Singer for duets, as TTML ttm:agent (v1, v2, …). */
  agent?: string
  words: LyricsWord[]
  /** Backing vocals sung over this cue. */
  background?: LyricsWord[]
  ruby?: LyricsRuby[]
}

export interface LyricsTrack {
  lang: string
  kind: 'translation' | 'transliteration'
  /** Text keyed by cue id. */
  lines: Record<string, string>
}

export interface LyricsDoc {
  version: 1
  timing: 'none' | 'line' | 'word'
  lang?: string
  cues: LyricsCue[]
  tracks: LyricsTrack[]
}

export function cueText(cue: Pick<LyricsCue, 'words'>): string {
  return cue.words.map(word => word.text).join('')
}

/**
 * Whether a cue is timed word by word: every word has a start and an end. In a word-timed
 * document, a cue whose words have no times is timed as a whole line, from its own begin;
 * credit lines and long held notes are often left that way.
 */
export function isWordTimedCue(cue: Pick<LyricsCue, 'words'>): boolean {
  return cue.words.length > 0 && cue.words.every(word => word.begin !== undefined && word.end !== undefined)
}

/** When a word's beat ends: its own end, else where the next beat or the word itself ends. */
export function syllableEnd(word: LyricsWord, index: number): number | undefined {
  const syllables = word.syllables ?? []
  return syllables[index]?.end ?? syllables[index + 1]?.begin ?? (index === syllables.length - 1 ? word.end : undefined)
}

/** Whether every beat of a word has a start, so its time can be told beat by beat. */
export function hasTimedSyllables(word: LyricsWord): boolean {
  return Boolean(word.syllables?.length) && word.syllables!.every(syllable => syllable.begin !== undefined)
}

/**
 * The time at `offset` characters into a word, sharing the word's time out by length; how a
 * word cut by a reading is timed. A word timed beat by beat shares out each beat's time
 * instead, so 運命 sung う・ん・め・い moves on with each mora. Undefined for untimed words.
 */
export function wordTimeAt(word: LyricsWord, offset: number): number | undefined {
  if (word.begin === undefined || word.end === undefined) {
    return undefined
  }
  const fraction = offset / Math.max(1, word.text.length)
  if (hasTimedSyllables(word)) {
    const syllables = word.syllables!
    const position = Math.min(fraction * syllables.length, syllables.length)
    const index = Math.min(Math.floor(position), syllables.length - 1)
    const begin = syllables[index].begin!
    const end = syllableEnd(word, index) ?? begin
    return Math.round(begin + (end - begin) * (position - index))
  }
  return Math.round(word.begin + (word.end - word.begin) * fraction)
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
 * In a word-timed document each cue is timed either word by word or as a whole line, never
 * half and half. Returns the first problem found, or null.
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
    if (doc.timing === 'word') {
      const timed = cue.words.filter(word => word.begin !== undefined || word.end !== undefined)
      if (timed.length > 0 && !isWordTimedCue(cue)) {
        return `Cue ${cue.id} has a word without timing`
      }
      if (timed.length > 0 && cue.background?.some(word => word.begin === undefined || word.end === undefined)) {
        return `Cue ${cue.id} has a backing vocal without timing`
      }
    }
    for (const word of [...cue.words, ...cue.background ?? []]) {
      if (word.begin !== undefined && word.end !== undefined && word.end < word.begin) {
        return `Cue ${cue.id} has a word that ends before it begins`
      }
      for (const syllable of word.syllables ?? []) {
        if (syllable.begin !== undefined && syllable.end !== undefined && syllable.end < syllable.begin) {
          return `Cue ${cue.id} has a beat that ends before it begins`
        }
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
