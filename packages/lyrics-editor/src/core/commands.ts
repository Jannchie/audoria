import type { LyricsCue, LyricsDoc, LyricsWord } from '@audoria/lyrics-core'
import { cueText, wordTimeAt } from '@audoria/lyrics-core'
import { splitCueIntoWords } from './split.js'

// Edits to a lyrics document while timing it. Each takes a document and returns a new one,
// leaving the input untouched, so history is just a list of documents. A document being timed
// may be incomplete (words without times); `finishTiming` fills what can be inferred before it
// is saved.

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

/** The word before `ref`, moving back to the previous cue with words; null before the first. */
export function previousWord(doc: LyricsDoc, ref: WordRef): WordRef | null {
  if (ref.word > 0) {
    return { cue: ref.cue, word: ref.word - 1 }
  }
  for (let cue = ref.cue - 1; cue >= 0; cue--) {
    const count = doc.cues[cue].words.length
    if (count > 0) {
      return { cue, word: count - 1 }
    }
  }
  return null
}

export function wordAt(doc: LyricsDoc, ref: WordRef): LyricsWord | undefined {
  return doc.cues[ref.cue]?.words[ref.word]
}

/**
 * Switches a document to word timing, cutting each cue into words. Lines already timed keep
 * their cue times, and their first word starts with the line.
 */
export function toWordTiming(doc: LyricsDoc): LyricsDoc {
  if (doc.timing === 'word') {
    return doc
  }
  return {
    ...doc,
    timing: 'word',
    cues: doc.cues.map((cue) => {
      const split = splitCueIntoWords(cue)
      if (split.words.length > 0 && cue.begin !== undefined) {
        split.words[0] = { ...split.words[0], begin: cue.begin }
      }
      return split
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

/**
 * Fills what timing leaves implied: a word without an end runs until the next word starts, and
 * the last word of a line until the next line starts but at most `maxHoldMs`, so a line before
 * an instrumental break doesn't run through it. Cue times follow their words.
 */
export function finishTiming(doc: LyricsDoc, maxHoldMs = 3000): LyricsDoc {
  if (doc.timing !== 'word') {
    return doc
  }
  const nextStart = (cueIndex: number, wordIndex: number, after: number): number | undefined => {
    for (let c = cueIndex; c < doc.cues.length; c++) {
      for (const word of doc.cues[c].words.slice(c === cueIndex ? wordIndex + 1 : 0)) {
        if (word.begin !== undefined && word.begin > after) {
          return word.begin
        }
      }
    }
    return undefined
  }
  return {
    ...doc,
    cues: doc.cues.map((cue, c) => syncCueTimes(doc, {
      ...cue,
      words: cue.words.map((word, w) => {
        if (word.begin === undefined || word.end !== undefined) {
          return word
        }
        const following = nextStart(c, w, word.begin)
        const isLast = w === cue.words.length - 1
        const end = isLast
          ? Math.min(following ?? Infinity, word.begin + maxHoldMs)
          : following ?? word.begin + maxHoldMs
        return { ...word, end }
      }),
    })),
  }
}

/** Lines that still have words without a start, with how many; what stands between a draft and a save. */
export function untimedWords(doc: LyricsDoc): Array<{ cue: number, count: number }> {
  return doc.cues.flatMap((cue, index) => {
    const count = cue.words.filter(word => word.begin === undefined).length
    return count > 0 ? [{ cue: index, count }] : []
  })
}
