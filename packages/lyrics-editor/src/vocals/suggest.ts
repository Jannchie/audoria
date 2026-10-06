import type { LyricsCue, LyricsDoc } from '@audoria/lyrics-core'
import type { VocalAnalysis } from './analysis.js'
import { cueStart, isSung, lineStatus, nextLine, nudgeWord, setLineBegin, setLineEnd, stampWordEnd } from '../core/commands.js'

/** A change to one line's timing the vocals suggest, to be reviewed before it is applied. */
export interface TimingSuggestion {
  cue: number
  edge: 'begin' | 'end'
  /** The line's current time for this edge, if it has one. */
  from?: number
  to: number
  /** High when the vocals clearly start or stop there; low ones deserve a listen first. */
  confidence: 'high' | 'low'
}

export interface SuggestOptions {
  /** How far a line start may move, in ms. */
  reach?: number
  /** The shortest silence before the next line that counts as the line having ended, in ms. */
  minBreak?: number
  /**
   * Start changes smaller than this aren't suggested, in ms. The vocals' frames are ~23 ms
   * apart and their onsets blur over a few; on hand-timed songs, smaller moves did more harm
   * than good.
   */
  minChange?: number
  /** End changes smaller than this aren't suggested, in ms; ends are vaguer than starts. */
  minEndChange?: number
}

// A start is a rise in the vocals' loudness over three frames (~70 ms); a strong one out of quiet
// is clearly a line starting, while a weaker one may be a word within it.
const ONSET_RISE_DB = 6
const STRONG_RISE_DB = 10
// Score bonus for a rise out of silence over one within singing, in dB.
const QUIET_BONUS_DB = 6
// The shortest a word may be left by moving its neighbour's edge, in ms.
const MIN_WORD_MS = 100

/** The loudness above which the vocals count as present: between their floor and their body. */
function activityThreshold(db: Float32Array): number {
  const sorted = Float32Array.from(db).sort()
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  const floor = at(0.1)
  const body = at(0.9)
  return floor + 0.4 * (body - floor)
}

/**
 * Suggests line starts and ends from the separated vocals. Each line is looked at only around
 * its own time, so instruments mistaken for voice in intros and breaks don't pull lines there:
 * - a start moves to the strongest rise in the vocals within `reach`, nearer ones preferred;
 * - an end is set where the vocals fall silent before the next line, when that silence lasts
 *   at least `minBreak`; lines sung straight into the next get none.
 */
export function suggestLineTiming(doc: LyricsDoc, analysis: VocalAnalysis, options: SuggestOptions = {}): TimingSuggestion[] {
  const { reach = 500, minBreak = 300, minChange = 80, minEndChange = 150 } = options
  const db = analysis.vocalDb
  const frameMs = 1000 / analysis.frameRate
  const toMs = (frame: number): number => Math.round(frame * frameMs)
  const toFrame = (ms: number): number => Math.max(0, Math.min(db.length - 1, Math.round(ms / frameMs)))
  const threshold = activityThreshold(db)
  const rise = (f: number): number => f < 3 ? 0 : db[f] - Math.min(db[f - 1], db[f - 2], db[f - 3])

  const lines = doc.cues.flatMap((cue, index) => {
    const start = cue.words.length > 0 && isSung(cue) ? cueStart(cue) : undefined
    // Where the line's last word starts and its first word ends, which a move must not cross.
    const timed = cue.words.filter(word => word.begin !== undefined)
    const lastStart = timed.at(-1)?.begin ?? start
    const firstEnd = timed[0]?.end
    return start === undefined ? [] : [{ index, cue, start, lastStart: lastStart!, firstEnd }]
  })

  const suggestions: TimingSuggestion[] = []
  for (const [i, { index, cue, start, firstEnd }] of lines.entries()) {
    const previous = lines[i - 1]
    const next = lines[i + 1]?.start ?? Infinity

    // Start: the strongest rise near the current start. It may cut the line before short (applying
    // ends that line there), but never into its last word, nor past this line's own first word.
    const from = toFrame(Math.max(start - reach, previous ? previous.lastStart + MIN_WORD_MS : -Infinity))
    const to = toFrame(Math.min(start + reach, next - minBreak, firstEnd === undefined ? Infinity : firstEnd - MIN_WORD_MS))
    let best: { frame: number, score: number, clear: boolean } | null = null
    for (let f = Math.max(from, 4); f <= to && f < db.length - 1; f++) {
      const r = rise(f)
      // The first frame of the steepest rise, so a step that stays steep for a few frames counts once.
      if (r < ONSET_RISE_DB || r <= rise(f - 1) || r < rise(f + 1) || db[f] < threshold) {
        continue
      }
      const quiet = Math.min(db[f - 3], db[f - 4]) < threshold
      const score = r + (quiet ? QUIET_BONUS_DB : 0) - 8 * Math.abs(toMs(f) - start) / reach
      if (!best || score > best.score) {
        best = { frame: f, score, clear: quiet && r >= STRONG_RISE_DB }
      }
    }
    if (best && Math.abs(toMs(best.frame) - start) >= minChange) {
      suggestions.push({ cue: index, edge: 'begin', from: start, to: toMs(best.frame), confidence: best.clear ? 'high' : 'low' })
    }

    // End: the last moment the vocals are present before a long enough silence ahead of the next line.
    if (!Number.isFinite(next)) {
      continue
    }
    const lineStart = toFrame(best ? toMs(best.frame) : start)
    let last = toFrame(next) - 1
    while (last > lineStart && db[last] < threshold) {
      last--
    }
    const end = toMs(last + 1)
    const current = cue.end ?? cue.words.at(-1)?.end
    if (last > lineStart && next - end >= minBreak && (current === undefined || Math.abs(end - current) >= minEndChange)) {
      // Reverb tails and held notes make ends vaguer than starts; they all deserve a listen.
      suggestions.push({ cue: index, edge: 'end', from: current, to: end, confidence: 'low' })
    }
  }
  return suggestions
}

/** When a line ends: its own end, or its last word's. */
function lineEnd(cue: LyricsCue): number | undefined {
  return cue.end ?? cue.words.at(-1)?.end
}

/** The nearest sung line before or after `index` that has a time. */
function neighbour(doc: LyricsDoc, index: number, direction: 1 | -1): number | null {
  return nextLine(doc, index, direction, cue => isSung(cue) && cueStart(cue) !== undefined)
}

/**
 * Starts a line at `at`. Only the first word moves in a word-timed line, so the rest of its
 * timing stands; a line before that would now overlap is ended where this one starts.
 */
function moveLineStart(doc: LyricsDoc, index: number, at: number): LyricsDoc {
  const cue = doc.cues[index]
  const first = cue?.words.findIndex(word => word.begin !== undefined) ?? -1
  if (!cue) {
    return doc
  }
  let next = first === -1
    ? setLineBegin(doc, index, cue.end === undefined ? at : Math.min(at, cue.end))
    : nudgeWord(doc, { cue: index, word: first }, 'begin', at - cue.words[first].begin!)
  const start = cueStart(next.cues[index])!
  const previous = neighbour(next, index, -1)
  const previousEnd = previous === null ? undefined : lineEnd(next.cues[previous])
  if (previous !== null && previousEnd !== undefined && previousEnd > start) {
    next = moveLineEnd(next, previous, start)
  }
  return next
}

/** Ends a line at `at`, but never after the next line starts. */
function moveLineEnd(doc: LyricsDoc, index: number, at: number): LyricsDoc {
  const cue = doc.cues[index]
  if (!cue) {
    return doc
  }
  const following = neighbour(doc, index, 1)
  const end = following === null ? at : Math.min(at, cueStart(doc.cues[following])!)
  if (lineStatus(cue) === 'line') {
    return setLineEnd(doc, index, end)
  }
  const last = { cue: index, word: cue.words.length - 1 }
  const word = cue.words[last.word]
  if (word.begin === undefined) {
    return doc
  }
  // An end before the word starts is held at its start; a missing end is simply set.
  return word.end === undefined ? stampWordEnd(doc, last, end) : nudgeWord(doc, last, 'end', end - word.end)
}

/** Applies accepted suggestions so that no two lines overlap, whichever of them are taken. */
export function applyTimingSuggestions(doc: LyricsDoc, suggestions: TimingSuggestion[]): LyricsDoc {
  let current = doc
  // Starts first, so ends are kept clear of where the following lines now start.
  for (const suggestion of suggestions.filter(item => item.edge === 'begin')) {
    current = moveLineStart(current, suggestion.cue, suggestion.to)
  }
  for (const suggestion of suggestions.filter(item => item.edge === 'end')) {
    current = moveLineEnd(current, suggestion.cue, suggestion.to)
  }
  return current
}
