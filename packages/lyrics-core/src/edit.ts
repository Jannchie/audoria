import type { LyricsCue, LyricsDoc, LyricsWord } from './doc.js'

/** Moves a cue, its words and backing vocals included, by `deltaMs`, clamping at zero. */
export function shiftCue(cue: LyricsCue, deltaMs: number): LyricsCue {
  const shift = (time: number | undefined): number | undefined =>
    time === undefined ? undefined : Math.max(0, Math.round(time + deltaMs))
  const shiftWords = (words: LyricsWord[]): LyricsWord[] =>
    words.map(word => ({ ...word, begin: shift(word.begin), end: shift(word.end) }))
  return {
    ...cue,
    begin: shift(cue.begin),
    end: shift(cue.end),
    words: shiftWords(cue.words),
    ...(cue.background ? { background: shiftWords(cue.background) } : {}),
  }
}

/** Moves every cue and word time by `deltaMs`, clamping at zero. */
export function shiftLyricsDoc(doc: LyricsDoc, deltaMs: number): LyricsDoc {
  return { ...doc, cues: doc.cues.map(cue => shiftCue(cue, deltaMs)) }
}
