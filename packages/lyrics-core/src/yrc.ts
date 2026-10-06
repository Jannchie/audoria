import type { LyricsCue, LyricsDoc, LyricsTrack, LyricsWord } from './doc.js'
import { cueText, detectLang } from './doc.js'

// NetEase Cloud Music's word-timed lyrics (YRC). Each line is
//   [lineStart,lineDuration](wordStart,wordDuration,0)word(wordStart,wordDuration,0)word…
// in milliseconds; credit lines may come as JSON instead: {"t":0,"c":[{"tx":"作词: "},{"tx":"…"}]}.

const LRC_LINE_RE = /^\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/
const LINE_RE = /^\[(\d+),(\d+)\](.*)$/
const WORD_RE = /\((\d+),(\d+),-?\d+\)/g

function parseYrcLine(line: string): Omit<LyricsCue, 'id'> | null {
  const match = LINE_RE.exec(line)
  if (match) {
    const begin = Number(match[1])
    const words: LyricsWord[] = []
    const tokens = [...match[3].matchAll(WORD_RE)]
    for (const [index, token] of tokens.entries()) {
      const text = match[3].slice(token.index + token[0].length, tokens[index + 1]?.index ?? match[3].length)
      const start = Number(token[1])
      if (!text) {
        continue
      }
      // A space timed on its own belongs to the word before it.
      if (!text.trim() && words.length > 0) {
        words.at(-1)!.text += text
        continue
      }
      // NetEase often starts a line with a space.
      words.push({ text: words.length === 0 ? text.trimStart() : text, begin: start, end: start + Number(token[2]) })
    }
    return words.length > 0 ? { begin, end: begin + Number(match[2]), words } : null
  }
  if (line.startsWith('{')) {
    try {
      const json = JSON.parse(line) as { t?: number, c?: Array<{ tx?: string }> }
      const text = (json.c ?? []).map(part => part.tx ?? '').join('').trim()
      return text && typeof json.t === 'number' ? { begin: json.t, words: [{ text }] } : null
    }
    catch {
      return null
    }
  }
  return null
}

/** The time of an LRC line matched by LRC_LINE_RE, in ms. */
function lrcTime(match: RegExpExecArray): number {
  return Number(match[1]) * 60_000 + Number(match[2]) * 1000 + (match[3] ? Number(match[3].padEnd(3, '0')) : 0)
}

/** Lines of an LRC as (time, text), for lining translations up with the original. */
function timedLines(lrc: string | undefined): Array<{ time: number, text: string }> {
  return (lrc ?? '').split(/\r?\n/).flatMap((line) => {
    const match = LRC_LINE_RE.exec(line.trim())
    return match ? [{ time: lrcTime(match), text: match[4].trim() }] : []
  })
}

const plain = (text: string): string => text.replaceAll(/\s+/g, '')

/**
 * Reads NetEase YRC into a word-timed document. A translation (LRC, timed like the original
 * LRC) is attached line by line: each translated line goes to the line the original LRC has at
 * its time, found in the YRC by its text, since the two are timed a little apart. Returns null
 * when the text holds no YRC lines.
 */
export function lyricsDocFromYrc(yrc: string, options: { lrc?: string, translation?: string } = {}): LyricsDoc | null {
  const lines = yrc.replaceAll(String.raw`\n`, '\n').split(/\r?\n/)
  const parsed = lines.map(line => parseYrcLine(line.trim())).filter((cue): cue is Omit<LyricsCue, 'id'> => cue !== null)
  if (!parsed.some(cue => cue.words.some(word => word.begin !== undefined))) {
    return null
  }
  const cues: LyricsCue[] = parsed
    .sort((a, b) => a.begin! - b.begin!)
    .map((cue, index) => ({ id: `c${index}`, ...cue }))

  const original = timedLines(options.lrc)
  const translated: Record<string, string> = {}
  let from = 0
  for (const { time, text } of timedLines(options.translation)) {
    const source = original.find(line => Math.abs(line.time - time) <= 10)?.text
    if (!text || text === '//' || !source) {
      continue
    }
    const at = cues.findIndex((cue, index) => index >= from && plain(cueText(cue)) === plain(source))
    if (at !== -1) {
      translated[cues[at].id] = text
      from = at + 1
    }
  }
  const tracks: LyricsTrack[] = Object.keys(translated).length > 0
    ? [{ lang: detectLang(Object.values(translated)) ?? 'und', kind: 'translation', lines: translated }]
    : []

  const lang = detectLang(cues.map(cueText))
  return { version: 1, timing: 'word', ...(lang ? { lang } : {}), cues, tracks }
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000).toString().padStart(2, '0')
  const seconds = Math.floor((ms % 60_000) / 1000).toString().padStart(2, '0')
  return `[${minutes}:${seconds}.${(ms % 1000).toString().padStart(3, '0')}]`
}

/**
 * NetEase LRC made plain: credit lines it writes as JSON ({"t":0,"c":[{"tx":"作词: "}, …]})
 * become timestamped lines, and a translation (LRC) is added as lines repeating the original's
 * timestamps, the way LRC carries translations. Translated lines at a time the original has no
 * line at are dropped.
 */
export function lrcFromNetease(lrc: string, translation?: string): string {
  const original = lrc.split(/\r?\n/).map((line) => {
    const credit = line.trim().startsWith('{') ? parseYrcLine(line.trim()) : null
    return credit ? `${formatTime(credit.begin!)}${cueText(credit)}` : line
  }).join('\n')
  const times = new Set(timedLines(original).map(line => line.time))
  const extra = (translation ?? '').split(/\r?\n/).filter((line) => {
    const match = LRC_LINE_RE.exec(line.trim())
    if (!match || !match[4].trim() || match[4].trim() === '//') {
      return false
    }
    return times.has(lrcTime(match))
  })
  return extra.length > 0 ? `${original}\n${extra.join('\n')}` : original
}
