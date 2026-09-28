import type { IpadicFeatures, Tokenizer } from 'kuromoji'
import { createRequire } from 'node:module'
import path from 'node:path'
import kuromoji from 'kuromoji'

export interface RubySegment {
  text: string
  /** Hiragana reading shown above `text`; absent for segments that need none. */
  ruby?: string
  /** The reading is written into the lyrics as `漢字(よみ)`, i.e. set by hand rather than analyzed. */
  explicit?: boolean
}

const KANJI_RE = /[\p{Script=Han}〆ヶ]/u
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
// Readings written into the lyrics, e.g. 運命(さだめ), take precedence over the analyzer.
const EXPLICIT_READING_SOURCE = String.raw`([\p{Script=Han}〆ヶ]+)[(（]([\p{Script=Hiragana}\p{Script=Katakana}ー]+)[)）]`
const LRC_TAG_RE = /^(?:\[[^\]]*\])+/

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

function annotateWords(text: string, tokenizer: Tokenizer<IpadicFeatures>): RubySegment[] {
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

async function annotateLine(line: string): Promise<RubySegment[]> {
  const cached = cache.get(line)
  if (cached) {
    return cached
  }

  const tokenizer = await getTokenizer()
  const segments: RubySegment[] = []
  let cursor = 0
  for (const match of line.matchAll(new RegExp(EXPLICIT_READING_SOURCE, 'gu'))) {
    segments.push(...annotateWords(line.slice(cursor, match.index), tokenizer), { text: match[1], ruby: match[2], explicit: true })
    cursor = match.index + match[0].length
  }
  segments.push(...annotateWords(line.slice(cursor), tokenizer))

  const result = mergePlainSegments(segments)
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(line, result)
  return result
}

/**
 * Annotates the Japanese lines of an LRC or plain-text lyric with furigana, keyed by the line's
 * raw text (timestamps stripped, `漢字(よみ)` notation kept). Lines without kana, such as
 * Chinese translations, and lines without kanji are left out.
 */
export async function annotateLyricsFurigana(lyrics: string): Promise<Record<string, RubySegment[]>> {
  const lines = new Set(
    lyrics
      .split('\n')
      .map(line => line.trim().replace(LRC_TAG_RE, '').trim())
      .filter(line => KANJI_RE.test(line) && (KANA_RE.test(line) || /[(（]/.test(line))),
  )

  const annotated: Record<string, RubySegment[]> = {}
  for (const line of lines) {
    annotated[line] = await annotateLine(line)
  }
  return annotated
}
