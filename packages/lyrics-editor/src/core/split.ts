import type { LyricsCue, LyricsRuby, LyricsWord } from '@audoria/lyrics-core'
import { cueText, sortedRuby, splitMorae } from '@audoria/lyrics-core'

// Characters that are sung as one beat with the character before them.
const ATTACHING_RE = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶーゝゞヽヾ々]/u
const SYLLABIC_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const WORD_CHAR_RE = /[\p{L}\p{N}'’]/u

/**
 * Where a cue's text would be cut into words for timing: each kanji, kana or hangul syllable on
 * its own (small kana and ー stay with the one before), runs of letters and digits as words,
 * and spaces and punctuation with the word before them. A reading is never cut, so 運命(さだめ)
 * stays one word. Returns the start offset of every word after the first.
 */
export function wordBreaks(text: string, atomic: Array<{ start: number, end: number }> = []): number[] {
  const breaks: number[] = []
  const chars = [...text]
  let offset = 0
  let previous: 'syllable' | 'word' | 'other' | null = null
  for (const char of chars) {
    const kind = SYLLABIC_RE.test(char) ? 'syllable' : WORD_CHAR_RE.test(char) ? 'word' : 'other'
    const startsWord = offset > 0
      && kind !== 'other'
      && !(kind === 'syllable' && ATTACHING_RE.test(char))
      && !(kind === 'word' && previous === 'word')
      && !atomic.some(range => offset > range.start && offset < range.end)
    if (startsWord) {
      breaks.push(offset)
    }
    previous = kind
    offset += char.length
  }
  return breaks
}

/** Cuts text at the given offsets into untimed words. */
export function wordsAt(text: string, breaks: number[]): LyricsWord[] {
  const bounds = [0, ...breaks, text.length]
  return bounds.slice(0, -1).map((start, index) => ({ text: text.slice(start, bounds[index + 1]) })).filter(word => word.text)
}

/** A cue's own readings, then `extra` ones (found by an analyzer) where they don't overlap one. */
export function mergeReadings(own: LyricsRuby[], extra: LyricsRuby[]): LyricsRuby[] {
  const kept = extra.filter(range => !own.some(mine => range.start < mine.end && mine.start < range.end))
  return [...own, ...kept].sort((a, b) => a.start - b.start)
}

/**
 * Re-cuts a cue's text into words for timing, dropping word times but keeping the cue's own.
 * Text under a reading stays one word, so it can be sung over the reading's beats.
 */
export function splitCueIntoWords(cue: LyricsCue, readings: LyricsRuby[] = []): LyricsCue {
  const text = cueText(cue)
  return { ...cue, words: wordsAt(text, wordBreaks(text, mergeReadings(sortedRuby(cue), readings))) }
}

/**
 * Gives a word under a reading of several beats those beats, to time one by one: 心 read
 * こころ gets こ・こ・ろ. Words that have beats, or whose text a reading doesn't cover exactly,
 * are left as they are.
 */
export function addSyllables(cue: LyricsCue, readings: LyricsRuby[] = []): LyricsCue {
  const ranges = mergeReadings(sortedRuby(cue), readings)
  if (ranges.length === 0) {
    return cue
  }
  let offset = 0
  const words = cue.words.map((word) => {
    const start = offset
    offset += word.text.length
    const range = word.syllables ? undefined : ranges.find(item => item.start === start && item.end === offset)
    const morae = range ? splitMorae(range.reading) : []
    return morae.length > 1 ? { ...word, syllables: morae.map(text => ({ text })) } : word
  })
  return { ...cue, words }
}
