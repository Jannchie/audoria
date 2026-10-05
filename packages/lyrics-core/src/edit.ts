import type { LyricsDoc, LyricsWord } from './doc.js'

/** Moves every cue and word time by `deltaMs`, clamping at zero. */
export function shiftLyricsDoc(doc: LyricsDoc, deltaMs: number): LyricsDoc {
  const shift = (time: number | undefined): number | undefined =>
    time === undefined ? undefined : Math.max(0, Math.round(time + deltaMs))
  const shiftWords = (words: LyricsWord[]): LyricsWord[] =>
    words.map(word => ({ ...word, begin: shift(word.begin), end: shift(word.end) }))
  return {
    ...doc,
    cues: doc.cues.map(cue => ({
      ...cue,
      begin: shift(cue.begin),
      end: shift(cue.end),
      words: shiftWords(cue.words),
      ...(cue.background ? { background: shiftWords(cue.background) } : {}),
    })),
  }
}
