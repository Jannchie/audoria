import type { LyricsDoc } from '../src/index.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { lyricsDocFromText, lyricsDocToText, shiftLyricsDoc, validateLyricsDoc, wordTimeAt } from '../src/index.js'

describe('lyricsDocFromText', () => {
  it('reads LRC lines into timed cues and repeated timestamps into translation tracks', () => {
    const doc = lyricsDocFromText('[ti:x]\n[00:01.50]外を見る\n[00:01.50]看向外面\n[00:03.00]\n[00:04.00]Hello')
    assert.deepEqual(doc, {
      version: 1,
      timing: 'line',
      lang: 'ja',
      cues: [
        { id: 'c0', begin: 1500, words: [{ text: '外を見る' }] },
        { id: 'c1', begin: 3000, words: [] },
        { id: 'c2', begin: 4000, words: [{ text: 'Hello' }] },
      ],
      tracks: [{ lang: 'zh', kind: 'translation', lines: { c0: '看向外面' } }],
    })
  })

  it('expands a line under several timestamps and keeps cues in time order', () => {
    const doc = lyricsDocFromText('[00:10.00][00:30.00]chorus\n[00:20.00]verse')!
    assert.deepEqual(doc.cues.map(cue => [cue.begin, cue.words[0].text]), [[10_000, 'chorus'], [20_000, 'verse'], [30_000, 'chorus']])
  })

  it('turns 漢字(よみ) notation into readings over the cue text', () => {
    const doc = lyricsDocFromText('[00:01.00]運命(さだめ)の今（いま）\n[00:02.00]x')!
    assert.deepEqual(doc.cues[0], {
      id: 'c0',
      begin: 1000,
      words: [{ text: '運命の今' }],
      ruby: [{ start: 0, end: 2, reading: 'さだめ' }, { start: 3, end: 4, reading: 'いま' }],
    })
  })

  it('reads text without timestamps as untimed cues', () => {
    const doc = lyricsDocFromText('first\n\nsecond')!
    assert.equal(doc.timing, 'none')
    assert.deepEqual(doc.cues.map(cue => cue.words), [[{ text: 'first' }], [], [{ text: 'second' }]])
  })

  it('returns null for blank lyrics', () => {
    assert.equal(lyricsDocFromText('  \n'), null)
    assert.equal(lyricsDocFromText(null), null)
  })
})

describe('lyricsDocToText', () => {
  it('round-trips line-timed LRC with readings and translations', () => {
    const lrc = '[00:01.500]運命(さだめ)の今\n[00:01.500]命运的现在\n[00:03.000]\n[01:04.020]Hello'
    const doc = lyricsDocFromText(lrc)!
    assert.equal(lyricsDocToText(doc), lrc)
    assert.deepEqual(lyricsDocFromText(lyricsDocToText(doc)), doc)
  })

  it('writes untimed documents as plain text', () => {
    assert.equal(lyricsDocToText(lyricsDocFromText('運命(さだめ)\n\nline')!), '運命(さだめ)\n\nline')
  })

  it('falls back to line timing for word-timed cues', () => {
    const doc: LyricsDoc = {
      version: 1,
      timing: 'word',
      cues: [{ id: 'a', begin: 1000, end: 2000, words: [{ text: 'Hel', begin: 1000, end: 1500 }, { text: 'lo', begin: 1500, end: 2000 }] }],
      tracks: [],
    }
    assert.equal(lyricsDocToText(doc), '[00:01.000]Hello')
  })
})

function wordTimedDoc(cue: Partial<LyricsDoc['cues'][number]>): LyricsDoc {
  return {
    version: 1,
    timing: 'word',
    cues: [{
      id: 'a',
      begin: 0,
      words: [{ text: '運命', begin: 0, end: 500 }, { text: 'の', begin: 500, end: 600 }],
      ...cue,
    }],
    tracks: [],
  }
}

describe('validateLyricsDoc', () => {
  it('accepts readings inside one word or over whole words', () => {
    assert.equal(validateLyricsDoc(wordTimedDoc({ ruby: [{ start: 0, end: 1, reading: 'うん' }] })), null)
    assert.equal(validateLyricsDoc(wordTimedDoc({ ruby: [{ start: 0, end: 3, reading: 'さだめの' }] })), null)
  })

  it('rejects readings that split a word, overlap or run past the text', () => {
    assert.match(validateLyricsDoc(wordTimedDoc({ ruby: [{ start: 1, end: 3, reading: 'めの' }] }))!, /splits a word/)
    assert.match(validateLyricsDoc(wordTimedDoc({ ruby: [{ start: 0, end: 2, reading: 'さだめ' }, { start: 1, end: 2, reading: 'め' }] }))!, /overlapping/)
    assert.match(validateLyricsDoc(wordTimedDoc({ ruby: [{ start: 2, end: 4, reading: 'x' }] }))!, /outside/)
  })

  it('rejects untimed words in a word-timed document and dangling translation lines', () => {
    assert.match(validateLyricsDoc(wordTimedDoc({ words: [{ text: 'x' }] }))!, /without timing/)
    assert.match(validateLyricsDoc({ ...wordTimedDoc({}), tracks: [{ lang: 'zh', kind: 'translation', lines: { b: 'x' } }] })!, /unknown cue/)
  })
})

describe('shiftLyricsDoc', () => {
  it('moves cue and word times, clamping at zero', () => {
    const shifted = shiftLyricsDoc({
      version: 1,
      timing: 'word',
      cues: [{ id: 'a', begin: 50, end: 900, words: [{ text: 'x', begin: 50, end: 900 }] }],
      tracks: [],
    }, -100)
    assert.deepEqual(shifted.cues[0], { id: 'a', begin: 0, end: 800, words: [{ text: 'x', begin: 0, end: 800 }] })
  })
})

describe('wordTimeAt', () => {
  it('shares a word\'s time out by length', () => {
    assert.equal(wordTimeAt({ text: 'abcd', begin: 0, end: 400 }, 1), 100)
    assert.equal(wordTimeAt({ text: 'abcd' }, 1), undefined)
  })
})
