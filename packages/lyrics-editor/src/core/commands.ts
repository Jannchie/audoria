import type { LyricsCue, LyricsDoc, LyricsRuby, LyricsSyllable, LyricsWord } from '@audoria/lyrics-core'
import { cueText, isWordTimedCue, settleBreaks, shiftCue as shiftCueTimes, validateLyricsDoc, wordTimeAt } from '@audoria/lyrics-core'
import { addSyllables, splitCueIntoWords } from './split.js'

// Edits to a lyrics document while timing it. Each takes a document and returns a new one,
// leaving the input untouched, so history is just a list of documents.
//
// Each line is timed one of two ways: as a whole, by the cue's own begin (credit lines, held
// notes, or a first pass over plain lyrics), or word by word. While editing, a line can be
// half way between; `incompleteLines` says which, and `finishTiming` fills what can be
// inferred before the document is saved.

/**
 * What is timed with one tap: a word, by cue index and word index within the cue, or, for a word
 * sung over several beats (the morae of a kanji's reading), one of its beats.
 */
export interface WordRef {
  cue: number
  word: number
  syllable?: number
}

/** Readings over a cue's text, beyond its own hand-set ones; where words get beats from. */
export type ReadingsOf = (cue: LyricsCue) => LyricsRuby[]

/** A word's edges follow its beats: it starts with the first and ends with the last. */
function followSyllables(word: LyricsWord): LyricsWord {
  const syllables = word.syllables
  if (!syllables?.length) {
    return word
  }
  const begin = syllables[0].begin
  const end = syllables.at(-1)!.end
  return { ...word, ...(begin === undefined ? {} : { begin }), ...(end === undefined ? {} : { end }) }
}

/** Moving a word's edges as a whole moves its first beat's start and its last beat's end. */
function leadSyllables(before: LyricsWord, after: LyricsWord): LyricsWord {
  const syllables = after.syllables
  if (!syllables?.length) {
    return after
  }
  const next = syllables.map(syllable => ({ ...syllable }))
  if (after.begin !== before.begin && after.begin !== undefined && next[0].begin !== undefined) {
    next[0].begin = after.begin
  }
  if (after.end !== before.end && after.end !== undefined && next.at(-1)!.end !== undefined) {
    next.at(-1)!.end = after.end
  }
  if (after.end === undefined && before.end !== undefined) {
    delete next.at(-1)!.end
  }
  if (after.begin === undefined) {
    return { ...after, syllables: next.map(syllable => ({ text: syllable.text })) }
  }
  return { ...after, syllables: next }
}

function updateCue(doc: LyricsDoc, index: number, update: (cue: LyricsCue) => LyricsCue): LyricsDoc {
  return { ...doc, cues: doc.cues.map((cue, i) => i === index ? syncCueTimes(doc, update(cue)) : cue) }
}

/** Changes a word as a whole; its beats follow. */
function updateWord(doc: LyricsDoc, ref: WordRef, update: (word: LyricsWord) => LyricsWord): LyricsDoc {
  return updateCue(doc, ref.cue, cue => ({ ...cue, words: cue.words.map((word, i) => i === ref.word ? leadSyllables(word, update(word)) : word) }))
}

/** Changes what `ref` names, a beat or a word; the word follows its beats. */
function updateUnit(doc: LyricsDoc, ref: WordRef, update: (unit: LyricsSyllable) => LyricsSyllable): LyricsDoc {
  if (ref.syllable === undefined) {
    return updateWord(doc, ref, word => ({ ...word, ...update(word) }))
  }
  return updateCue(doc, ref.cue, cue => ({
    ...cue,
    words: cue.words.map((word, i) => i === ref.word && word.syllables
      ? followSyllables({ ...word, syllables: word.syllables.map((syllable, j) => j === ref.syllable ? update(syllable) : syllable) })
      : word),
  }))
}

/** The beat or word `ref` names. */
export function unitAt(doc: LyricsDoc, ref: WordRef): LyricsSyllable | undefined {
  const word = wordAt(doc, ref)
  return ref.syllable === undefined ? word : word?.syllables?.[ref.syllable]
}

/** Where tapping starts in a word: its first beat, if it has beats. */
export function firstUnit(doc: LyricsDoc, cue: number, word: number): WordRef {
  return doc.cues[cue]?.words[word]?.syllables?.length ? { cue, word, syllable: 0 } : { cue, word }
}

/** The beat or word tapped after `ref`, moving on to the next cue with words; null past the last. */
export function nextUnit(doc: LyricsDoc, ref: WordRef): WordRef | null {
  const count = wordAt(doc, ref)?.syllables?.length ?? 0
  if (ref.syllable !== undefined && ref.syllable + 1 < count) {
    return { ...ref, syllable: ref.syllable + 1 }
  }
  const next = nextWord(doc, ref)
  return next && firstUnit(doc, next.cue, next.word)
}

/** The beat or word tapped before `ref` in the same cue; null at the cue's start. */
export function previousUnit(doc: LyricsDoc, ref: WordRef): WordRef | null {
  if (ref.syllable !== undefined && ref.syllable > 0) {
    return { ...ref, syllable: ref.syllable - 1 }
  }
  const word = doc.cues[ref.cue]?.words[ref.word - 1]
  if (!word) {
    return null
  }
  return word.syllables?.length ? { cue: ref.cue, word: ref.word - 1, syllable: word.syllables.length - 1 } : { cue: ref.cue, word: ref.word - 1 }
}

/** Every timed beat or word, in order: what a word's neighbours are on the timeline. */
function timedUnits(doc: LyricsDoc): WordRef[] {
  return doc.cues.flatMap((cue, c) => cue.words.flatMap((word, w) => word.syllables?.some(syllable => syllable.begin !== undefined)
    ? word.syllables.flatMap((syllable, s) => syllable.begin === undefined ? [] : [{ cue: c, word: w, syllable: s }])
    : word.begin === undefined ? [] : [{ cue: c, word: w }]))
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
export function prepareForTiming(doc: LyricsDoc, readingsOf?: ReadingsOf): LyricsDoc {
  return {
    ...doc,
    timing: 'word',
    cues: doc.cues.map((cue) => {
      const readings = readingsOf?.(cue) ?? []
      return addSyllables(cue.words.some(word => word.begin !== undefined) ? cue : splitCueIntoWords(cue, readings), readings)
    }),
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
  let next = updateUnit(doc, ref, ({ end, ...unit }) => ({ ...unit, begin: time, ...(end !== undefined && end >= time ? { end } : {}) }))
  const before = previousUnit(next, ref)
  const previous = before && unitAt(next, before)
  if (before && previous && (previous.end === undefined || previous.end > time) && (previous.begin ?? -1) < time) {
    next = updateUnit(next, before, unit => ({ ...unit, end: time }))
  }
  return { doc: next, next: nextUnit(next, ref) }
}

/** Ends the beat or word at `ref` at `time`, for a pause before the next one starts. */
export function stampWordEnd(doc: LyricsDoc, ref: WordRef, at: number): LyricsDoc {
  const time = Math.round(at)
  return updateUnit(doc, ref, unit => unit.begin !== undefined && unit.begin < time ? { ...unit, end: time } : unit)
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

/**
 * Drags one edge of a word, or the whole word, by `deltaMs`, as one would on a timeline: an edge
 * shared with the neighbouring word (one ends where the next begins) moves for both of them, and
 * a word never runs into a neighbour it doesn't share an edge with. Neighbours are the timed words
 * either side, across lines too; every word keeps at least `minMs`. With `detach`, a shared edge
 * moves for this word alone, so it can only pull away from its neighbour and leave a gap.
 */
export function dragWord(doc: LyricsDoc, ref: WordRef, edge: 'begin' | 'end' | 'both', deltaMs: number, options: { detach?: boolean, minMs?: number } = {}): LyricsDoc {
  const { detach = false, minMs = 30 } = options
  const word = unitAt(doc, ref)
  if (word?.begin === undefined) {
    return doc
  }
  const timed = timedUnits(doc)
  const at = timed.findIndex(item => item.cue === ref.cue && item.word === ref.word && item.syllable === ref.syllable)
  const before = timed[at - 1] ? { ref: timed[at - 1], word: unitAt(doc, timed[at - 1])! } : undefined
  const after = timed[at + 1] ? { ref: timed[at + 1], word: unitAt(doc, timed[at + 1])! } : undefined
  const begin = word.begin
  const end = word.end
  const gluedBefore = !detach && before?.word.end !== undefined && Math.abs(before.word.end - begin) <= 1
  const gluedAfter = !detach && after !== undefined && end !== undefined && Math.abs(after.word.begin! - end) <= 1

  // How far the start may go: down to the word before's start when they share an edge, else to
  // its end; up to this word's own end, unless the whole word moves.
  const beginLow = before === undefined ? 0 : gluedBefore ? before.word.begin! + minMs : (before.word.end ?? before.word.begin! + minMs)
  const endHigh = after === undefined
    ? Infinity
    : gluedAfter ? (after.word.end === undefined ? Infinity : after.word.end - minMs) : after.word.begin!
  let low: number
  let high: number
  if (edge === 'begin') {
    low = beginLow - begin
    high = (end === undefined ? (after ? after.word.begin! - minMs : Infinity) : end - minMs) - begin
  }
  else if (edge === 'end') {
    if (end === undefined) {
      return doc
    }
    low = begin + minMs - end
    high = endHigh - end
  }
  else {
    low = beginLow - begin
    high = end === undefined ? (after ? after.word.begin! - minMs : Infinity) - begin : endHigh - end
  }
  const delta = Math.round(Math.min(Math.max(deltaMs, low), Math.max(low, high)))
  if (delta === 0) {
    return doc
  }

  let next = updateUnit(doc, ref, item => ({
    ...item,
    ...(edge === 'end' ? {} : { begin: begin + delta }),
    ...(edge !== 'begin' && end !== undefined ? { end: end + delta } : {}),
  }))
  if (edge !== 'end' && gluedBefore) {
    next = updateUnit(next, before!.ref, item => ({ ...item, end: begin + delta }))
  }
  if (edge !== 'begin' && gluedAfter) {
    next = updateUnit(next, after!.ref, item => ({ ...item, begin: end! + delta }))
  }
  return next
}

/** An untimed copy of a word, keeping its beats' text. */
function untimed(word: LyricsWord): LyricsWord {
  return { text: word.text, ...(word.syllables ? { syllables: word.syllables.map(syllable => ({ text: syllable.text })) } : {}) }
}

/**
 * Removes the times of a beat or a word, or with `ref.word` omitted, of every word of a cue.
 * Clearing a word's first beat clears the word: the word starts with it.
 */
export function clearTiming(doc: LyricsDoc, ref: { cue: number, word?: number, syllable?: number }): LyricsDoc {
  if (ref.word !== undefined && ref.syllable !== undefined && ref.syllable > 0) {
    return updateUnit(doc, { cue: ref.cue, word: ref.word, syllable: ref.syllable }, unit => ({ text: unit.text }))
  }
  return updateCue(doc, ref.cue, cue => ({
    ...cue,
    words: cue.words.map((word, i) => ref.word === undefined || i === ref.word ? untimed(word) : word),
  }))
}

/** Cuts a word in two at `offset` characters, sharing its time out by length. */
export function splitWord(doc: LyricsDoc, ref: WordRef, offset: number): LyricsDoc {
  return updateCue(doc, ref.cue, (cue) => {
    const word = cue.words[ref.word]
    if (!word || offset <= 0 || offset >= word.text.length) {
      return cue
    }
    // A reading's beats can't be cut with its text; the halves are timed as wholes.
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
    // Beats belong to one word's reading; the joined word is timed as a whole.
    const merged: LyricsWord = { text: word.text + after.text, begin: word.begin ?? after.begin, end: after.end ?? word.end }
    return { ...cue, words: [...cue.words.slice(0, ref.word), merged, ...cue.words.slice(ref.word + 2)] }
  })
}

/**
 * Replaces a cue's text. Readings are kept only while the text they sit on is unchanged;
 * the cue is cut into words again and its word times dropped.
 */
export function setCueText(doc: LyricsDoc, index: number, text: string, readingsOf?: ReadingsOf): LyricsDoc {
  return updateCue(doc, index, (cue) => {
    const previous = cueText(cue)
    const ruby = (cue.ruby ?? []).filter(range => text.slice(range.start, range.end) === previous.slice(range.start, range.end))
    const { ruby: _ruby, ...rest } = cue
    const next: LyricsCue = { ...rest, words: text ? [{ text }] : [], ...(ruby.length > 0 ? { ruby } : {}) }
    if (doc.timing !== 'word') {
      return next
    }
    // Readings found for the old text no longer hold; only the line's own ones are used.
    const readings = readingsOf ? readingsOf(next).filter(range => text.slice(range.start, range.end) === previous.slice(range.start, range.end)) : []
    return addSyllables(splitCueIntoWords(next, readings), readings)
  })
}

/** Shifts a whole line, its words and backing vocals included, by `deltaMs`. */
export function shiftLine(doc: LyricsDoc, index: number, deltaMs: number): LyricsDoc {
  return updateCue(doc, index, cue => shiftCueTimes(cue, deltaMs))
}

/**
 * Marks `at` as the start of a whole line. A line with any word timed moves as a whole so its
 * first timed word lands on `at`, keeping its rhythm; otherwise only the line's begin changes.
 */
export function stampLine(doc: LyricsDoc, index: number, at: number): LyricsDoc {
  const cue = doc.cues[index]
  const time = Math.round(at)
  if (!cue) {
    return doc
  }
  const start = cue.words.find(word => word.begin !== undefined)?.begin
  if (start !== undefined) {
    return shiftLine(doc, index, time - start)
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

/**
 * Sets where a line timed as a whole ends, never before it starts; undefined removes it, so the
 * line runs on until the next one.
 */
export function setLineEnd(doc: LyricsDoc, index: number, end: number | undefined): LyricsDoc {
  return updateCue(doc, index, (cue) => {
    const { end: _end, ...rest } = cue
    return end === undefined || cue.begin === undefined ? rest : { ...rest, end: Math.max(cue.begin, Math.round(end)) }
  })
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

/** Lines the space bar walks through: sung lines, not credits (blank lines have no words). */
export function isSung(cue: Pick<LyricsCue, 'words'>): boolean {
  return !isCreditLine(cue)
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
 *   the first timed line are spread over the intro, the others start with the line before,
 *   and blank lines inside the line before them move to its end (see `settleBreaks`);
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
        let finished = word
        if (word.begin !== undefined && word.end === undefined) {
          const following = nextStart(c, w, word.begin)
          const isLast = w === cue.words.length - 1
          const end = isLast ? Math.min(following ?? Infinity, word.begin + maxHoldMs) : following ?? word.begin + maxHoldMs
          finished = { ...word, end }
        }
        return finishSyllables(finished)
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
  return settleBreaks({ ...doc, timing: wordTimed ? 'word' : firstTimed >= 0 ? 'line' : 'none', cues })
}

/**
 * A word's beats saved as they can be: untimed ones dropped (the word is then timed as a whole),
 * and each timed beat running until the next starts, the last until the word ends.
 */
function finishSyllables(word: LyricsWord): LyricsWord {
  const syllables = word.syllables
  if (!syllables?.length) {
    return word
  }
  if (word.begin === undefined || !syllables.every(syllable => syllable.begin !== undefined)) {
    const { syllables: _syllables, ...rest } = word
    return rest
  }
  return {
    ...word,
    syllables: syllables.map((syllable, i) => syllable.end === undefined
      ? { ...syllable, end: syllables[i + 1]?.begin ?? word.end }
      : syllable),
  }
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
