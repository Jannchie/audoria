import type { LyricsDoc } from '@audoria/lyrics-core'
import { validateLyricsDoc } from '@audoria/lyrics-core'
import { describe, expect, it } from 'vitest'
import { clearTiming, finishTiming, History, mergeWithNext, nextWord, nudgeWord, previousWord, setCueText, splitWord, stampWordEnd, stampWordStart, toWordTiming, wordBreaks, wordsAt } from '../src/core'

function lineDoc(...lines: Array<[number, string]>): LyricsDoc {
  return { version: 1, timing: 'line', cues: lines.map(([begin, text], i) => ({ id: `c${i}`, begin, words: [{ text }] })), tracks: [] }
}

describe('wordbreaks', () => {
  it('cuts japanese per syllable, keeping small kana and readings whole', () => {
    expect(wordsAt('運命の今しょっ', wordBreaks('運命の今しょっ', [{ start: 0, end: 2 }])).map(word => word.text))
      .toEqual(['運命', 'の', '今', 'しょっ'])
  })

  it('cuts latin text at words, keeping spaces and punctuation with the word before', () => {
    expect(wordsAt('Hello, world! It\'s me', wordBreaks('Hello, world! It\'s me')).map(word => word.text))
      .toEqual(['Hello, ', 'world! ', 'It\'s ', 'me'])
  })
})

describe('timing commands', () => {
  it('turns lines into untimed words that start with their line', () => {
    const doc = toWordTiming(lineDoc([1000, 'あい'], [5000, 'Hi you']))
    expect(doc.timing).toBe('word')
    expect(doc.cues.map(cue => cue.words)).toEqual([
      [{ text: 'あ', begin: 1000 }, { text: 'い' }],
      [{ text: 'Hi ', begin: 5000 }, { text: 'you' }],
    ])
  })

  it('stamps word starts in turn, ending each word where the next begins', () => {
    let doc = toWordTiming(lineDoc([0, 'あい'], [0, 'う']))
    let ref = { cue: 0, word: 0 }
    for (const time of [100, 300, 900]) {
      const result = stampWordStart(doc, ref, time)
      doc = result.doc
      ref = result.next ?? ref
    }
    expect(doc.cues.map(cue => [cue.begin, cue.end, cue.words])).toEqual([
      [100, undefined, [{ text: 'あ', begin: 100, end: 300 }, { text: 'い', begin: 300 }]],
      [900, undefined, [{ text: 'う', begin: 900 }]],
    ])
  })

  it('stamps whole milliseconds from a fractional playback clock', () => {
    const doc = toWordTiming(lineDoc([0, 'あい']))
    expect(stampWordStart(doc, { cue: 0, word: 0 }, 1234.56).doc.cues[0].words[0].begin).toBe(1235)
    expect(stampWordEnd(doc, { cue: 0, word: 0 }, 99.4).cues[0].words[0].end).toBe(99)
  })

  it('keeps an end stamped for a pause when the next word starts later', () => {
    let doc = toWordTiming(lineDoc([0, 'あい']))
    doc = stampWordStart(doc, { cue: 0, word: 0 }, 100).doc
    doc = stampWordEnd(doc, { cue: 0, word: 0 }, 200)
    doc = stampWordStart(doc, { cue: 0, word: 1 }, 500).doc
    expect(doc.cues[0].words).toEqual([{ text: 'あ', begin: 100, end: 200 }, { text: 'い', begin: 500 }])
  })

  it('nudges an edge without crossing the other, and moves whole words', () => {
    const doc: LyricsDoc = { version: 1, timing: 'word', cues: [{ id: 'a', begin: 100, end: 300, words: [{ text: 'x', begin: 100, end: 300 }] }], tracks: [] }
    expect(nudgeWord(doc, { cue: 0, word: 0 }, 'begin', 500).cues[0].words[0]).toEqual({ text: 'x', begin: 300, end: 300 })
    expect(nudgeWord(doc, { cue: 0, word: 0 }, 'both', -150).cues[0]).toMatchObject({ begin: 0, end: 150 })
  })

  it('splits and merges words, sharing and joining their time', () => {
    const doc: LyricsDoc = { version: 1, timing: 'word', cues: [{ id: 'a', words: [{ text: 'abcd', begin: 0, end: 400 }] }], tracks: [] }
    const split = splitWord(doc, { cue: 0, word: 0 }, 1)
    expect(split.cues[0].words).toEqual([{ text: 'a', begin: 0, end: 100 }, { text: 'bcd', begin: 100, end: 400 }])
    expect(mergeWithNext(split, { cue: 0, word: 0 }).cues[0].words).toEqual([{ text: 'abcd', begin: 0, end: 400 }])
  })

  it('walks words across lines, skipping empty ones', () => {
    const doc = toWordTiming(lineDoc([0, 'あい'], [0, ''], [0, 'う']))
    expect(nextWord(doc, { cue: 0, word: 1 })).toEqual({ cue: 2, word: 0 })
    expect(previousWord(doc, { cue: 2, word: 0 })).toEqual({ cue: 0, word: 1 })
    expect(nextWord(doc, { cue: 2, word: 0 })).toBeNull()
  })

  it('re-cuts edited text, keeping readings over unchanged text', () => {
    const doc: LyricsDoc = { version: 1, timing: 'word', cues: [{ id: 'a', words: [{ text: '運命', begin: 0, end: 1 }, { text: 'の', begin: 1, end: 2 }], ruby: [{ start: 0, end: 2, reading: 'さだめ' }] }], tracks: [] }
    expect(setCueText(doc, 0, '運命だ').cues[0]).toEqual({ id: 'a', words: [{ text: '運命' }, { text: 'だ' }], ruby: [{ start: 0, end: 2, reading: 'さだめ' }] })
    expect(setCueText(doc, 0, '宿命').cues[0].ruby).toBeUndefined()
  })

  it('clears times, and fills the ends timing leaves implied so the result validates', () => {
    let doc = toWordTiming(lineDoc([0, 'あい'], [0, 'う']))
    for (const [ref, time] of [[{ cue: 0, word: 0 }, 100], [{ cue: 0, word: 1 }, 200], [{ cue: 1, word: 0 }, 9000]] as const) {
      doc = stampWordStart(doc, ref, time).doc
    }
    const finished = finishTiming(doc)
    expect(finished.cues.map(cue => cue.words.map(word => word.end))).toEqual([[200, 3200], [12_000]])
    expect(validateLyricsDoc(finished)).toBeNull()
    expect(clearTiming(finished, { cue: 0 }).cues[0].words).toEqual([{ text: 'あ' }, { text: 'い' }])
  })
})

describe('history', () => {
  it('undoes and redoes, merging grouped steps', () => {
    const history = new History(0)
    history.record(1)
    history.record(2, 'nudge')
    history.record(3, 'nudge')
    expect(history.undo()).toBe(1)
    expect(history.redo()).toBe(3)
    history.undo()
    history.record(5)
    expect(history.canRedo).toBe(false)
  })
})
