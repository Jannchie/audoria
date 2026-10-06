import type { LyricsDoc } from '../src/index.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { lyricsDocFromText, mergeLyricsText, validateLyricsDoc } from '../src/index.js'

const timed: LyricsDoc = {
  version: 1,
  timing: 'word',
  tracks: [{ lang: 'en', kind: 'translation', lines: { a: 'one', b: 'two' } }],
  cues: [
    { id: 'a', begin: 1000, end: 2000, words: [{ text: 'あ', begin: 1000, end: 1500 }, { text: 'い', begin: 1500, end: 2000 }] },
    { id: 'gap', begin: 2000, words: [] },
    { id: 'b', begin: 3000, end: 4000, words: [{ text: 'う', begin: 3000, end: 4000 }] },
  ],
}

describe('mergeLyricsText', () => {
  it('keeps the word timing of lines whose text is unchanged', () => {
    const merged = mergeLyricsText(timed, lyricsDocFromText('[00:01.00]あい\n[00:02.00]\n[00:03.10]う')!)
    assert.deepEqual(merged, timed)
  })

  it('takes new and reworded lines from the text, and drops lines no longer there', () => {
    const merged = mergeLyricsText(timed, lyricsDocFromText('[00:00.50]まえ\n[00:01.00]あい\n[00:03.00]え')!)
    assert.deepEqual(merged.cues.map(cue => [cue.id, cue.begin, cue.words.length]), [['m0', 500, 1], ['a', 1000, 2], ['m1', 3000, 1]])
    assert.equal(merged.timing, 'word')
    assert.deepEqual(merged.tracks[0].lines, { a: 'one' })
    assert.equal(validateLyricsDoc(merged), null)
  })

  it('takes translations written in the text', () => {
    const merged = mergeLyricsText(timed, lyricsDocFromText('[00:01.00]あい\n[00:01.00]first\n[00:03.00]う')!)
    assert.deepEqual(merged.tracks.map(track => track.lines), [{ a: 'first' }])
    assert.equal(merged.cues[1].words[0].begin, 3000)
  })
})
