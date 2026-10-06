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

/**
 * Keeps blank lines, which mark a break after a line, out of the line before them: a blank that
 * starts before that line has ended moves to its end, though never past the next timed line.
 * Retiming leaves blanks at their old times, where they would cut a line short mid-word.
 */
export function settleBreaks(doc: LyricsDoc): LyricsDoc {
  let changed = false
  let previous: LyricsCue | undefined
  const cues = doc.cues.map((cue, index) => {
    if (cue.words.length > 0) {
      previous = cue
      return cue
    }
    const end = previous?.end ?? previous?.words.at(-1)?.end
    if (cue.begin === undefined || end === undefined || cue.begin >= end) {
      return cue
    }
    const next = doc.cues.slice(index + 1).find(item => item.words.length > 0 && item.begin !== undefined)?.begin
    changed = true
    return { ...cue, begin: Math.min(end, next ?? end) }
  })
  return changed ? { ...doc, cues } : doc
}
