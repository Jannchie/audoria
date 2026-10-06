import type { LyricsDoc } from '@audoria/lyrics-core'
import type { VocalAnalysis } from '../src/vocals/analysis'
import { describe, expect, it } from 'vitest'
import { decodeVocalAnalysis, encodeVocalAnalysis } from '../src/vocals/analysis'
import { applyTimingSuggestions, suggestLineTiming } from '../src/vocals/suggest'

const FRAME_RATE = 50 // 20 ms frames keep the arithmetic readable

/** Vocals that are silent (20 dB) except within the given [from, to) ms spans (60 dB). */
function vocalsSinging(spans: Array<[number, number]>, ms = 10_000): VocalAnalysis {
  const vocalDb = new Float32Array(ms / 20).fill(20)
  for (const [from, to] of spans) {
    vocalDb.fill(60, from / 20, to / 20)
  }
  return { model: 'test', frameRate: FRAME_RATE, vocalDb, mixDb: new Float32Array(vocalDb.length), peaks: { rate: 200, min: new Float32Array(0), max: new Float32Array(0) } }
}

function lineDoc(...lines: Array<[number, string]>): LyricsDoc {
  return { version: 1, timing: 'line', tracks: [], cues: lines.map(([begin, text], i) => ({ id: `c${i}`, begin, words: [{ text }] })) }
}

describe('vocal analysis encoding', () => {
  it('round-trips, and rejects anything else', () => {
    const analysis = vocalsSinging([[1000, 2000]], 2000)
    analysis.peaks = { rate: 200, min: Float32Array.of(-0.5, -0.25), max: Float32Array.of(0.5, 0.75) }
    expect(decodeVocalAnalysis(encodeVocalAnalysis(analysis))).toEqual(analysis)
    expect(decodeVocalAnalysis(new ArrayBuffer(16))).toBeNull()
  })
})

describe('suggestlinetiming', () => {
  it('moves starts to where the vocals come in and ends to where they stop before a break', () => {
    const analysis = vocalsSinging([[1000, 3000], [5000, 7000]])
    const doc = lineDoc([1300, 'a'], [4800, 'b'])
    expect(suggestLineTiming(doc, analysis)).toEqual([
      { cue: 0, edge: 'begin', from: 1300, to: 1000, confidence: 'high' },
      { cue: 0, edge: 'end', from: undefined, to: 3000, confidence: 'low' },
      { cue: 1, edge: 'begin', from: 4800, to: 5000, confidence: 'high' },
    ])
  })

  it('leaves starts already close enough, and ignores vocals far from any line', () => {
    const analysis = vocalsSinging([[200, 600], [1000, 3000]])
    expect(suggestLineTiming(lineDoc([1040, 'a']), analysis)).toEqual([])
  })

  it('suggests no end for a line sung straight into the next', () => {
    const analysis = vocalsSinging([[1000, 5000]])
    const suggestions = suggestLineTiming(lineDoc([1000, 'a'], [3000, 'b']), analysis)
    expect(suggestions.filter(item => item.edge === 'end')).toEqual([])
  })

  it('moves only the first word of a word-timed line, and sets its last word\'s end', () => {
    const doc: LyricsDoc = {
      version: 1,
      timing: 'word',
      tracks: [],
      cues: [{ id: 'a', begin: 1300, words: [{ text: 'x', begin: 1300, end: 1500 }, { text: 'y', begin: 1500 }] }],
    }
    const applied = applyTimingSuggestions(doc, [
      { cue: 0, edge: 'end', to: 2500, confidence: 'low' },
      { cue: 0, edge: 'begin', from: 1300, to: 1000, confidence: 'high' },
    ])
    expect(applied.cues[0].words.map(word => [word.begin, word.end])).toEqual([[1000, 1500], [1500, 2500]])
    expect(applied.cues[0].begin).toBe(1000)
  })

  it('never leaves two lines overlapping, whichever suggestions are taken', () => {
    const doc: LyricsDoc = {
      version: 1,
      timing: 'word',
      tracks: [],
      cues: [
        { id: 'a', begin: 1000, end: 3000, words: [{ text: 'x', begin: 1000, end: 2000 }, { text: 'y', begin: 2000, end: 3000 }] },
        { id: 'b', begin: 3000, end: 3500, words: [{ text: 'z', begin: 3000, end: 3500 }] },
      ],
    }
    const earlier = { cue: 1, edge: 'begin' as const, from: 3000, to: 2500, confidence: 'high' as const }
    const later = { cue: 0, edge: 'end' as const, from: 3000, to: 3200, confidence: 'low' as const }
    const span = (applied: LyricsDoc): number[][] => applied.cues.map(cue => [cue.begin!, cue.end!])
    expect(span(applyTimingSuggestions(doc, [earlier]))).toEqual([[1000, 2500], [2500, 3500]])
    expect(span(applyTimingSuggestions(doc, [later]))).toEqual([[1000, 3000], [3000, 3500]])
    expect(span(applyTimingSuggestions(doc, [earlier, later]))).toEqual([[1000, 2500], [2500, 3500]])
  })

  it('suggests no start inside the line before\'s last word', () => {
    const analysis = vocalsSinging([[1000, 1500], [2000, 4000]])
    const doc: LyricsDoc = {
      version: 1,
      timing: 'word',
      tracks: [],
      cues: [
        { id: 'a', begin: 1000, words: [{ text: 'x', begin: 1000, end: 1950 }, { text: 'y', begin: 1950, end: 2300 }] },
        { id: 'b', begin: 2300, words: [{ text: 'z', begin: 2300, end: 3000 }] },
      ],
    }
    expect(suggestLineTiming(doc, analysis).filter(item => item.cue === 1)).toEqual([])
  })
})
