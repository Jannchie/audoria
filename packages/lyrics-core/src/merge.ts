import type { LyricsCue, LyricsDoc, LyricsTrack } from './doc.js'
import { cueText, isWordTimedCue } from './doc.js'
import { settleBreaks } from './edit.js'

/** Pairs of indexes into `a` and `b` whose items are equal, in order, as many as possible. */
function matchInOrder(a: string[], b: string[]): Array<[number, number]> {
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++
    }
    else {
      j++
    }
  }
  return pairs
}

/**
 * Takes in lyrics given as text (LRC) without losing the finer timing already there: a line
 * whose text is unchanged keeps its cue, word times and end included; new or reworded lines
 * come from `incoming` with its line times, and lines no longer there are dropped. Readings
 * and translations written in the text win, since the text is what was edited.
 */
export function mergeLyricsText(previous: LyricsDoc, incoming: LyricsDoc): LyricsDoc {
  const kept = new Map(matchInOrder(incoming.cues.map(cueText), previous.cues.map(cueText)))
  const used = new Set(previous.cues.map(cue => cue.id))
  const ids = new Map<string, string>()
  let fresh = 0
  const cues = incoming.cues.map((cue, index): LyricsCue => {
    const match = kept.get(index)
    if (match !== undefined) {
      const old = previous.cues[match]
      ids.set(cue.id, old.id)
      return cue.ruby ? { ...old, ruby: cue.ruby } : old
    }
    while (used.has(`m${fresh}`)) {
      fresh++
    }
    const id = `m${fresh}`
    used.add(id)
    ids.set(cue.id, id)
    return { ...cue, id }
  })

  const remap = (track: LyricsTrack): LyricsTrack => ({
    ...track,
    lines: Object.fromEntries(Object.entries(track.lines).flatMap(([id, line]) => ids.has(id) ? [[ids.get(id)!, line]] : [])),
  })
  const survivors = new Set(cues.map(cue => cue.id))
  const tracks = incoming.tracks.length > 0
    ? incoming.tracks.map(remap)
    : previous.tracks.map(track => ({ ...track, lines: Object.fromEntries(Object.entries(track.lines).filter(([id]) => survivors.has(id))) }))

  const timing = cues.some(cue => isWordTimedCue(cue)) ? 'word' : cues.some(cue => cue.begin !== undefined) ? 'line' : 'none'
  return settleBreaks({ ...previous, timing, cues, tracks })
}
