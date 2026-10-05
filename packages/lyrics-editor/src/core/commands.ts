import type { LyricsCue, LyricsDoc, LyricsWord } from '@audoria/lyrics-core'
import { cueText, isWordTimedCue, shiftCue as shiftCueTimes, validateLyricsDoc, wordTimeAt } from '@audoria/lyrics-core'
import { splitCueIntoWords } from './split.js'

// Edits to a lyrics document while timing it. Each takes a document and returns a new one,
// leaving the input untouched, so history is just a list of documents.
//
// Each line is timed one of two ways: as a whole, by the cue's own begin (credit lines, held
// notes, or a first pass over plain lyrics), or word by word. While editing, a line can be
// half way between; `incompleteLines` says which, and `finishTiming` fills what can be
// inferred before the document is saved.

/** A word, by cue index and word index within the cue. */
export interface WordRef {
  cue: number
  word: number
}

function updateCue(doc: LyricsDoc, index: number, update: (cue: LyricsCue) => LyricsCue): LyricsDoc {
  return { ...doc, cues: doc.cues.map((cue, i) => i === index ? syncCueTimes(doc, update(cue)) : cue) }
}

function updateWord(doc: LyricsDoc, ref: WordRef, update: (word: LyricsWord) => LyricsWord): LyricsDoc {
  return updateCue(doc, ref.cue, cue => ({ ...cue, words: cue.words.map((word, i) => i === ref.word ? update(word) : word) }))
}

/** In a word-timed document a cue spans its words; its own times follow theirs. */
function syncCueTimes(doc: LyricsDoc, cue: LyricsCue): LyricsCue {
  if (doc.timing !== 'word' || cue.words.length === 0) {
    return cue
  }
  const begin = cue.words[0].begin ?? cue.begin
  const end = cue.words.at(-1)!.end ?? cue.end
  return { ...cue, ...(begin === undefined ? {} : { begin }), ...(end === undefined ? {} : { end }) }
}

/** The word after `ref`, moving on to the next cue with words; null past the last. */
export function nextWord(doc: LyricsDoc, ref: WordRef): WordRef | null {
  if (ref.word + 1 < (doc.cues[ref.cue]?.words.length ?? 0)) {
    return { cue: ref.cue, word: ref.word + 1 }
  }
  for (let cue = ref.cue + 1; cue < doc.cues.length; cue++) {
    if (doc.cues[cue].words.length > 0) {
      return { cue, word: 0 }
    }
  }
  return null
}

/** When a line starts: its first timed word, or the line's own begin. */
export function cueStart(cue: LyricsCue): number | undefined {
  return cue.words.find(word => word.begin !== undefined)?.begin ?? cue.begin
}

/** The line being heard at `ms`: the last line with words that has started; -1 before any. */
export function lineAt(doc: LyricsDoc, ms: number): number {
  let found = -1
  for (const [index, cue] of doc.cues.entries()) {
    const start = cueStart(cue)
    if (cue.words.length > 0 && start !== undefined && start <= ms) {
      found = index
    }
  }
  return found
}

/** The next line after `from` (or before, going back) that has words and passes `accept`. */
export function nextLine(doc: LyricsDoc, from: number, direction: 1 | -1, accept: (cue: LyricsCue) => boolean = () => true): number | null {
  for (let i = from + direction; i >= 0 && i < doc.cues.length; i += direction) {
    if (doc.cues[i].words.length > 0 && accept(doc.cues[i])) {
      return i
    }
  }
  return null
}

/** Where timing picks up: the first line with words still to time, else the first line with words. */
export function firstOpenLine(doc: LyricsDoc): number {
  const open = doc.cues.findIndex((cue) => {
    const status = lineStatus(cue)
    return status === 'untimed' || status === 'partial'
  })
  return Math.max(0, open === -1 ? doc.cues.findIndex(cue => cue.words.length > 0) : open)
}

export function wordAt(doc: LyricsDoc, ref: WordRef): LyricsWord | undefined {
  return doc.cues[ref.cue]?.words[ref.word]
}

/**
 * Gets a document ready for timing: lines not yet timed word by word are cut into words, with
 * the words untimed and the line keeping its own begin. Word-timed lines are left as they are.
 */
export function prepareForTiming(doc: LyricsDoc): LyricsDoc {
  return {
    ...doc,
    timing: 'word',
    cues: doc.cues.map(cue => cue.words.some(word => word.begin !== undefined) ? cue : splitCueIntoWords(cue)),
  }
}

/**
 * Marks `time` as the start of the word at `ref`, which ends the word before it in the line
 * unless that one already ended earlier. A line's last word is left for `stampWordEnd` or
 * `finishTiming`, since the next line often follows a breath or a break. Returns the document
 * and the word to mark next.
 */
export function stampWordStart(doc: LyricsDoc, ref: WordRef, at: number): { doc: LyricsDoc, next: WordRef | null } {
  // Documents hold whole milliseconds; playback clocks don't.
  const time = Math.round(at)
  let next = updateWord(doc, ref, word => ({ ...word, begin: time, ...(word.end !== undefined && word.end < time ? { end: undefined } : {}) }))
  const before = { cue: ref.cue, word: ref.word - 1 }
  const previous = wordAt(next, before)
  if (previous && (previous.end === undefined || previous.end > time) && (previous.begin ?? -1) < time) {
    next = updateWord(next, before, word => ({ ...word, end: time }))
  }
  return { doc: next, next: nextWord(next, ref) }
}

/** Ends the word at `ref` at `time`, for a pause before the next word starts. */
export function stampWordEnd(doc: LyricsDoc, ref: WordRef, at: number): LyricsDoc {
  const time = Math.round(at)
  return updateWord(doc, ref, word => word.begin !== undefined && word.begin < time ? { ...word, end: time } : word)
}

/** Moves one edge of a word, or the whole word, by `deltaMs`; never below zero or past its other edge. */
export function nudgeWord(doc: LyricsDoc, ref: WordRef, edge: 'begin' | 'end' | 'both', deltaMs: number): LyricsDoc {
  return updateWord(doc, ref, (word) => {
    const move = (time: number | undefined): number | undefined => time === undefined ? undefined : Math.max(0, Math.round(time + deltaMs))
    if (edge === 'both') {
      return { ...word, begin: move(word.begin), end: move(word.end) }
    }
    const moved = move(word[edge])
    if (moved === undefined) {
      return word
    }
    const limited = edge === 'begin'
      ? Math.min(moved, word.end ?? moved)
      : Math.max(moved, word.begin ?? moved)
    return { ...word, [edge]: limited }
  })
}

/** Removes the times of a word, or with `ref.word` omitted, of every word of a cue. */
export function clearTiming(doc: LyricsDoc, ref: { cue: number, word?: number }): LyricsDoc {
  return updateCue(doc, ref.cue, cue => ({
    ...cue,
    words: cue.words.map((word, i) => ref.word === undefined || i === ref.word ? { text: word.text } : word),
  }))
}

/** Cuts a word in two at `offset` characters, sharing its time out by length. */
export function splitWord(doc: LyricsDoc, ref: WordRef, offset: number): LyricsDoc {
  return updateCue(doc, ref.cue, (cue) => {
    const word = cue.words[ref.word]
    if (!word || offset <= 0 || offset >= word.text.length) {
      return cue
    }
    const middle = wordTimeAt(word, offset)
    const first: LyricsWord = { text: word.text.slice(0, offset), begin: word.begin, end: middle }
    const second: LyricsWord = { text: word.text.slice(offset), begin: middle, end: word.end }
    return { ...cue, words: [...cue.words.slice(0, ref.word), first, second, ...cue.words.slice(ref.word + 1)] }
  })
}

/** Joins a word with the one after it in the same cue, spanning both their times. */
export function mergeWithNext(doc: LyricsDoc, ref: WordRef): LyricsDoc {
  return updateCue(doc, ref.cue, (cue) => {
    const word = cue.words[ref.word]
    const after = cue.words[ref.word + 1]
    if (!word || !after) {
      return cue
    }
    const merged: LyricsWord = { text: word.text + after.text, begin: word.begin ?? after.begin, end: after.end ?? word.end }
    return { ...cue, words: [...cue.words.slice(0, ref.word), merged, ...cue.words.slice(ref.word + 2)] }
  })
}

/**
 * Replaces a cue's text. Readings are kept only while the text they sit on is unchanged;
 * the cue is cut into words again and its word times dropped.
 */
export function setCueText(doc: LyricsDoc, index: number, text: string): LyricsDoc {
  return updateCue(doc, index, (cue) => {
    const previous = cueText(cue)
    const ruby = (cue.ruby ?? []).filter(range => text.slice(range.start, range.end) === previous.slice(range.start, range.end))
    const { ruby: _ruby, ...rest } = cue
    const next: LyricsCue = { ...rest, words: text ? [{ text }] : [], ...(ruby.length > 0 ? { ruby } : {}) }
    return doc.timing === 'word' ? splitCueIntoWords(next) : next
  })
}

/** Shifts a whole line, its words and backing vocals included, by `deltaMs`. */
export function shiftLine(doc: LyricsDoc, index: number, deltaMs: number): LyricsDoc {
  return updateCue(doc, index, cue => shiftCueTimes(cue, deltaMs))
}

/**
 * Marks `at` as the start of a whole line. A line already timed word by word moves with it,
 * keeping its rhythm; otherwise only the line's begin changes.
 */
export function stampLine(doc: LyricsDoc, index: number, at: number): LyricsDoc {
  const cue = doc.cues[index]
  const time = Math.round(at)
  if (!cue) {
    return doc
  }
  if (isWordTimedCue(cue) && cue.begin !== undefined) {
    return shiftLine(doc, index, time - cue.begin)
  }
  return setLineBegin(doc, index, time)
}

/** Sets a line's own begin, or with undefined removes it; for undoing a stamp exactly. */
export function setLineBegin(doc: LyricsDoc, index: number, begin: number | undefined): LyricsDoc {
  return {
    ...doc,
    cues: doc.cues.map((cue, i) => {
      if (i !== index) {
        return cue
      }
      const { begin: _begin, ...rest } = cue
      return begin === undefined ? rest : { ...rest, begin }
    }),
  }
}

/** Times a line as a whole again, dropping its word times; the line keeps its begin. */
export function toWholeLine(doc: LyricsDoc, index: number): LyricsDoc {
  return updateCue(doc, index, cue => ({
    ...cue,
    begin: cueStart(cue),
    words: cue.words.map(word => ({ text: word.text })),
    ...(cue.background ? { background: cue.background.map(word => ({ text: word.text })) } : {}),
  }))
}

const CREDIT_RE = /^\s*[^\s:：]{1,16}\s*[:：]/u

/**
 * Whether a line reads as a credit rather than a sung line, like `作词 : 姚若龙` or
 * `Composer: …`: a short label then a colon. Credits may be left untimed.
 */
export function isCreditLine(cue: Pick<LyricsCue, 'words'>): boolean {
  const text = cueText(cue)
  return text.length <= 60 && CREDIT_RE.test(text)
}

export type LineStatus = 'empty' | 'untimed' | 'line' | 'partial' | 'word'

/** How far a line is timed: not at all, as a whole line, some of its words, or every word. */
export function lineStatus(cue: LyricsCue): LineStatus {
  if (cue.words.length === 0) {
    return 'empty'
  }
  const timed = cue.words.filter(word => word.begin !== undefined).length
  if (timed === 0) {
    return cue.begin === undefined ? 'untimed' : 'line'
  }
  return timed === cue.words.length ? 'word' : 'partial'
}

/**
 * Lines that keep a draft from being saved: lines with words only partly timed, and sung lines
 * with no time at all. Credits and empty lines may stay untimed; `finishTiming` places them.
 */
export function incompleteLines(doc: LyricsDoc): number[] {
  return doc.cues.flatMap((cue, index) => {
    const status = lineStatus(cue)
    return status === 'partial' || (status === 'untimed' && !isCreditLine(cue)) ? [index] : []
  })
}

/**
 * Fills what timing leaves implied, so the draft saves as a valid document:
 * - a word without an end runs until the next word starts, and a line's last word until the
 *   next line starts but at most `maxHoldMs`, so it doesn't run through a break;
 * - untimed credits and empty lines take their place between timed neighbours: those before
 *   the first timed line are spread over the intro, the others start with the line before;
 * - lines timed as a whole are kept as one word, and a document with no word-timed line at
 *   all is saved as line timing.
 */
export function finishTiming(doc: LyricsDoc, maxHoldMs = 3000): LyricsDoc {
  const nextStart = (cueIndex: number, wordIndex: number, after: number): number | undefined => {
    for (let c = cueIndex; c < doc.cues.length; c++) {
      const cue = doc.cues[c]
      const starts = c === cueIndex ? cue.words.slice(wordIndex + 1).map(word => word.begin) : [cue.words[0]?.begin ?? cue.begin]
      const found = starts.find(start => start !== undefined && start > after)
      if (found !== undefined) {
        return found
      }
    }
    return undefined
  }

  const cues = doc.cues.map((cue, c) => {
    if (!cue.words.some(word => word.begin !== undefined)) {
      const text = cueText(cue)
      return { ...cue, words: text ? [{ text }] : [] }
    }
    return syncCueTimes(doc, {
      ...cue,
      words: cue.words.map((word, w) => {
        if (word.begin === undefined || word.end !== undefined) {
          return word
        }
        const following = nextStart(c, w, word.begin)
        const isLast = w === cue.words.length - 1
        const end = isLast ? Math.min(following ?? Infinity, word.begin + maxHoldMs) : following ?? word.begin + maxHoldMs
        return { ...word, end }
      }),
    })
  })

  const firstTimed = cues.findIndex(cue => cue.begin !== undefined)
  if (firstTimed !== -1) {
    const firstBegin = cues[firstTimed].begin!
    for (let i = 0; i < cues.length; i++) {
      if (cues[i].begin === undefined) {
        const begin = i < firstTimed ? Math.round(firstBegin * (i + 1) / (firstTimed + 1)) : cues[i - 1].begin!
        cues[i] = { ...cues[i], begin }
      }
    }
  }

  const wordTimed = cues.some(cue => isWordTimedCue(cue))
  return { ...doc, timing: wordTimed ? 'word' : firstTimed >= 0 ? 'line' : 'none', cues }
}

export type SaveCheck
  = | { ok: true, doc: LyricsDoc }
    | { ok: false, incomplete: number[] }
    | { ok: false, problem: string }

/**
 * Turns a draft into the document to save: every sung line timed, implied times filled in,
 * and the result valid. Otherwise says which lines are unfinished, or what is wrong.
 */
export function prepareSave(doc: LyricsDoc): SaveCheck {
  const incomplete = incompleteLines(doc)
  if (incomplete.length > 0) {
    return { ok: false, incomplete }
  }
  const finished = finishTiming(doc)
  const problem = validateLyricsDoc(finished)
  return problem ? { ok: false, problem } : { ok: true, doc: finished }
}
