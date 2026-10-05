import type { LyricsCue, LyricsWord } from '@audoria/lyrics-core'
import { cueText, sortedRuby } from '@audoria/lyrics-core'

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

/** Re-cuts a cue's text into words for timing, dropping word times but keeping the cue's own. */
export function splitCueIntoWords(cue: LyricsCue): LyricsCue {
  const text = cueText(cue)
  return { ...cue, words: wordsAt(text, wordBreaks(text, sortedRuby(cue))) }
}
