import type { LyricsDoc, LyricsRuby } from '@audoria/lyrics-core'
import type { IpadicFeatures, Tokenizer } from 'kuromoji'
import { createRequire } from 'node:module'
import path from 'node:path'
import { cueText, rubyRuns } from '@audoria/lyrics-core'
import kuromoji from 'kuromoji'

export interface RubySegment {
  text: string
  /** Hiragana reading shown above `text`; absent for segments that need none. */
  ruby?: string
  /** The reading was set by hand rather than analyzed. */
  explicit?: boolean
}

const KANJI_RE = /[\p{Script=Han}〆ヶ]/u
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u

// Standalone words the IPA dictionary tends to misread as prefixes or on'yomi.
const READING_OVERRIDES: Record<string, string> = {
  今: 'いま',
}

const CACHE_LIMIT = 5000
const cache = new Map<string, RubySegment[]>()

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | null = null

function getTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  tokenizerPromise ??= new Promise((resolve, reject) => {
    const dicPath = path.join(path.dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict')
    kuromoji.builder({ dicPath }).build((error, tokenizer) => {
      if (error) {
        tokenizerPromise = null
        reject(error)
        return
      }
      resolve(tokenizer)
    })
  })
  return tokenizerPromise
}

function toHiragana(value: string): string {
  // Katakana ァ (U+30A1) to ヶ (U+30F6) sit exactly 0x60 above their hiragana counterparts.
  // eslint-disable-next-line regexp/no-obscure-range
  return value.replaceAll(/[ァ-ヶ]/g, char => String.fromCodePoint(char.codePointAt(0)! - 0x60))
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/**
 * Splits a word into kanji and kana runs and gives each kanji run its share of the reading,
 * using the kana runs as anchors: 取り消し + とりけし → 取(と) り 消(け) し.
 */
function alignReading(surface: string, reading: string): RubySegment[] {
  const runs = surface.match(/[\p{Script=Han}〆ヶ]+|[^\p{Script=Han}〆ヶ]+/gu) ?? [surface]
  const pattern = runs
    .map(run => KANJI_RE.test(run) ? '(.+?)' : `(${escapeRegExp(toHiragana(run))})`)
    .join('')
  const match = new RegExp(`^${pattern}$`, 'u').exec(reading)
  if (!match) {
    return [{ text: surface, ruby: reading }]
  }
  return runs.map((run, index) => KANJI_RE.test(run) ? { text: run, ruby: match[index + 1] } : { text: run })
}

// Jukujikun: whole-word readings the tokenizer splits into per-kanji numerals/on'yomi (二人 → に+にん).
const WORD_READINGS: Record<string, string> = {
  一人: 'ひとり',
  二人: 'ふたり',
  今日: 'きょう',
  明日: 'あした',
  昨日: 'きのう',
  大人: 'おとな',
  今年: 'ことし',
  今朝: 'けさ',
  一日: 'いちにち',
}
const WORD_READINGS_RE = new RegExp(Object.keys(WORD_READINGS).join('|'), 'g')

function annotateWords(text: string, tokenizer: Tokenizer<IpadicFeatures>): RubySegment[] {
  const segments: RubySegment[] = []
  let cursor = 0
  for (const match of text.matchAll(WORD_READINGS_RE)) {
    segments.push(...annotateTokens(text.slice(cursor, match.index), tokenizer), { text: match[0], ruby: WORD_READINGS[match[0]] })
    cursor = match.index + match[0].length
  }
  segments.push(...annotateTokens(text.slice(cursor), tokenizer))
  return segments
}

function annotateTokens(text: string, tokenizer: Tokenizer<IpadicFeatures>): RubySegment[] {
  if (!text) {
    return []
  }
  return tokenizer.tokenize(text).flatMap((token) => {
    const surface = token.surface_form
    if (!KANJI_RE.test(surface)) {
      return [{ text: surface }]
    }
    const reading = READING_OVERRIDES[surface] ?? (token.reading && token.reading !== '*' ? toHiragana(token.reading) : '')
    return reading ? alignReading(surface, reading) : [{ text: surface }]
  })
}

function mergePlainSegments(segments: RubySegment[]): RubySegment[] {
  const merged: RubySegment[] = []
  for (const segment of segments) {
    const previous = merged.at(-1)
    if (previous && !previous.ruby && !segment.ruby && !KANJI_RE.test(previous.text + segment.text)) {
      previous.text += segment.text
    }
    else {
      merged.push({ ...segment })
    }
  }
  return merged
}

async function annotateCue(text: string, ruby: LyricsRuby[]): Promise<RubySegment[]> {
  const cacheKey = ruby.length > 0 ? `${text}\u0000${JSON.stringify(ruby)}` : text
  const cached = cache.get(cacheKey)
  if (cached) {
    return cached
  }

  // Hand-set readings take precedence; the analyzer reads the text between them.
  const tokenizer = await getTokenizer()
  const segments = rubyRuns({ words: [{ text }], ruby }).flatMap(run =>
    run.reading ? [{ text: run.text, ruby: run.reading, explicit: true }] : annotateWords(run.text, tokenizer))

  const result = mergePlainSegments(segments)
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(cacheKey, result)
  return result
}

/**
 * Annotates the Japanese cues of a lyrics document with furigana, keyed by cue id. Cues without
 * kanji, and cues without kana or hand-set readings (such as Chinese lines), are left out.
 */
export async function annotateLyricsFurigana(doc: LyricsDoc): Promise<Record<string, RubySegment[]>> {
  const annotated: Record<string, RubySegment[]> = {}
  for (const cue of doc.cues) {
    const text = cueText(cue)
    const ruby = cue.ruby ?? []
    if (KANJI_RE.test(text) && (KANA_RE.test(text) || ruby.length > 0)) {
      annotated[cue.id] = await annotateCue(text, ruby)
    }
  }
  return annotated
}
