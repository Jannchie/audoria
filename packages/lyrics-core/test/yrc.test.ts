import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { lrcFromNetease, lyricsDocFromText, lyricsDocFromYrc, validateLyricsDoc } from '../src/index.js'

// Shaped like NetEase's: a JSON credit line, a literal "\n" between lines, a space timed apart.
const YRC = [
  '{"t":0,"c":[{"tx":"作词: "},{"tx":"姚若龙"}]}',
  String.raw`[28970,2000](28970,800,0)一(29770,420,0)开(30190,300,0) (30490,500,0)始\n[42180,1200](42180,950,0)最(43130,250,0)后`,
].join('\n')
const LRC = '[00:00.00]作词: 姚若龙\n[00:29.18]一开 始\n[00:42.35]最后'
const TRANSLATION = '[00:29.18]At first\n[00:42.35]//\n[00:50.00]Nowhere'

describe('lyricsDocFromYrc', () => {
  it('reads word-timed lines, credit lines and spaces', () => {
    const doc = lyricsDocFromYrc(YRC)!
    assert.equal(doc.timing, 'word')
    assert.deepEqual(doc.cues.map(cue => [cue.begin, cue.end, cue.words.map(word => word.text).join('|')]), [
      [0, undefined, '作词: 姚若龙'],
      [28_970, 30_970, '一|开 |始'],
      [42_180, 43_380, '最|后'],
    ])
    assert.deepEqual(doc.cues[1].words[1], { text: '开 ', begin: 29_770, end: 30_190 })
    assert.equal(validateLyricsDoc(doc), null)
  })

  it('attaches the translation by the original LRC line at its time, found by text', () => {
    const doc = lyricsDocFromYrc(YRC, { lrc: LRC, translation: TRANSLATION })!
    assert.deepEqual(doc.tracks.map(track => [track.kind, track.lines]), [['translation', { c1: 'At first' }]])
  })

  it('returns null without YRC lines', () => {
    assert.equal(lyricsDocFromYrc('[00:01.00]plain LRC'), null)
  })
})

describe('lrcFromNetease', () => {
  it('adds translated lines under the originals they share a time with', () => {
    const doc = lyricsDocFromText(lrcFromNetease(LRC, TRANSLATION))!
    assert.deepEqual(doc.tracks.map(track => track.lines), [{ c1: 'At first' }])
    assert.equal(doc.cues.length, 3)
  })

  it('turns JSON credit lines into timestamped ones', () => {
    const lrc = '{"t":401,"c":[{"tx":"作曲: "},{"tx":"r-906"}]}\n[00:01.205]きっと'
    assert.equal(lrcFromNetease(lrc), '[00:00.401]作曲: r-906\n[00:01.205]きっと')
  })
})
