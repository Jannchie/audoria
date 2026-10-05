import type { LyricsCue, LyricsDoc, LyricsRuby, LyricsTrack } from './doc.js'
import { cueText, detectLang, rubyRuns } from './doc.js'

const LRC_TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g
const LRC_LEADING_TIMESTAMPS_RE = /^(?:\[\d{1,3}:\d{2}(?:\.\d{1,3})?\])+/
// Hand-written furigana inside lyrics: 運命(さだめ).
const READING_NOTATION_RE = /([\p{Script=Han}〆ヶ]+)[(（]([\p{Script=Hiragana}\p{Script=Katakana}ー]+)[)）]/gu
const KANJI_ONLY_RE = /^[\p{Script=Han}〆ヶ]+$/u

function isLrcFormat(raw: string): boolean {
  let timestampCount = 0
  for (const line of raw.split('\n').slice(0, 20)) {
    if (LRC_LEADING_TIMESTAMPS_RE.test(line.trim())) {
      timestampCount++
    }
  }
  return timestampCount >= 2
}

/** Splits `運命(さだめ)の今` into the text `運命の今` and a reading over 運命. */
function parseReadingNotation(source: string): { text: string, ruby: LyricsRuby[] } {
  const ruby: LyricsRuby[] = []
  let text = ''
  let cursor = 0
  for (const match of source.matchAll(READING_NOTATION_RE)) {
    text += source.slice(cursor, match.index) + match[1]
    ruby.push({ start: text.length - match[1].length, end: text.length, reading: match[2] })
    cursor = match.index + match[0].length
  }
  return { text: text + source.slice(cursor), ruby }
}

function formatReadingNotation(cue: LyricsCue): string {
  // The notation can only carry readings over kanji; others don't survive the LRC round trip.
  return rubyRuns(cue)
    .map(run => run.reading && KANJI_ONLY_RE.test(run.text) ? `${run.text}(${run.reading})` : run.text)
    .join('')
}

function toCue(id: string, source: string, begin?: number): LyricsCue {
  const { text, ruby } = parseReadingNotation(source)
  return {
    id,
    ...(begin === undefined ? {} : { begin }),
    words: text ? [{ text }] : [],
    ...(ruby.length > 0 ? { ruby } : {}),
  }
}

function parseLrcTimestamp(minutesRaw: string, secondsRaw: string, msRaw?: string): number {
  const ms = msRaw ? Number.parseInt(msRaw.padEnd(3, '0'), 10) : 0
  return Number.parseInt(minutesRaw, 10) * 60_000 + Number.parseInt(secondsRaw, 10) * 1000 + ms
}

function formatLrcTimestamp(totalMs: number): string {
  const ms = Math.max(0, Math.round(totalMs))
  const minutes = Math.floor(ms / 60_000).toString().padStart(2, '0')
  const seconds = Math.floor((ms % 60_000) / 1000).toString().padStart(2, '0')
  return `[${minutes}:${seconds}.${(ms % 1000).toString().padStart(3, '0')}]`
}

function parseLrc(raw: string): LyricsDoc {
  const entries: Array<{ time: number, text: string }> = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    const prefix = LRC_LEADING_TIMESTAMPS_RE.exec(trimmed)?.[0]
    if (!prefix) {
      continue
    }
    const text = trimmed.slice(prefix.length).trim()
    // A line under several timestamps (`[00:10][00:30]chorus`) is sung at each of them.
    for (const match of prefix.matchAll(LRC_TIMESTAMP_RE)) {
      entries.push({ time: parseLrcTimestamp(match[1], match[2], match[3]), text })
    }
  }
  // Stable sort keeps file order within a timestamp, so the original stays ahead of its translations.
  entries.sort((a, b) => a.time - b.time)

  // Lines repeating a timestamp are how LRC carries translations: the first is the original,
  // the n-th distinct one after it goes to the n-th translation track.
  const groups: Array<{ time: number, source: string, translations: string[] }> = []
  for (const entry of entries) {
    const previous = groups.at(-1)
    if (!previous || previous.time !== entry.time) {
      groups.push({ time: entry.time, source: entry.text, translations: [] })
    }
    else if (!entry.text || entry.text === previous.source || previous.translations.includes(entry.text)) {
      continue
    }
    else if (previous.source) {
      previous.translations.push(entry.text)
    }
    else {
      previous.source = entry.text
    }
  }

  const cues = groups.map((group, index) => toCue(`c${index}`, group.source, group.time))
  const trackCount = Math.max(0, ...groups.map(group => group.translations.length))
  const tracks: LyricsTrack[] = Array.from({ length: trackCount }, (_, trackIndex) => {
    const lines: Record<string, string> = {}
    for (const [index, group] of groups.entries()) {
      const translation = group.translations[trackIndex]
      if (translation) {
        lines[cues[index].id] = translation
      }
    }
    return { lang: detectLang(Object.values(lines)) ?? 'und', kind: 'translation', lines }
  })

  const lang = detectLang(cues.map(cueText))
  return { version: 1, timing: 'line', ...(lang ? { lang } : {}), cues, tracks }
}

function parsePlain(raw: string): LyricsDoc {
  const cues = raw.trim().split('\n').map((line, index) => toCue(`c${index}`, line.trim()))
  const lang = detectLang(cues.map(cueText))
  return { version: 1, timing: 'none', ...(lang ? { lang } : {}), cues, tracks: [] }
}

/**
 * Reads LRC or plain-text lyrics into a lyrics document. Cue ids are positional (`c0`, `c1`, …),
 * so the same text always yields the same ids. Returns null for blank input.
 */
export function lyricsDocFromText(raw: string | null | undefined): LyricsDoc | null {
  if (!raw?.trim()) {
    return null
  }
  return isLrcFormat(raw) ? parseLrc(raw) : parsePlain(raw)
}

/**
 * Writes a lyrics document as LRC (or plain text when it has no timing), with readings over
 * kanji as `漢字(よみ)` and translations as lines repeating the original's timestamp. Word
 * timing and readings over non-kanji text are dropped.
 */
export function lyricsDocToText(doc: LyricsDoc): string {
  if (doc.timing === 'none') {
    return doc.cues.map(formatReadingNotation).join('\n')
  }
  const translations = doc.tracks.filter(track => track.kind === 'translation')
  return doc.cues
    .flatMap((cue) => {
      const timestamp = formatLrcTimestamp(cue.begin ?? 0)
      return [
        `${timestamp}${formatReadingNotation(cue)}`,
        ...translations.flatMap(track => track.lines[cue.id] ? [`${timestamp}${track.lines[cue.id]}`] : []),
      ]
    })
    .join('\n')
}
