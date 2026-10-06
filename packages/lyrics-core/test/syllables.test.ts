import type { LyricsWord } from '../src/index.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { layoutLine, shiftCue, splitMorae, wordTimeAt } from '../src/index.js'

// 運命 sung う・ん・め・い, the last beat held longer.
const unmei: LyricsWord = {
  text: '運命',
  begin: 1000,
  end: 2000,
  syllables: [{ text: 'う', begin: 1000 }, { text: 'ん', begin: 1100 }, { text: 'め', begin: 1200 }, { text: 'い', begin: 1300, end: 2000 }],
}

describe('splitMorae', () => {
  it('cuts a reading into beats, keeping small kana, っ and ー with the one before', () => {
    assert.deepEqual(splitMorae('こころ'), ['こ', 'こ', 'ろ'])
    assert.deepEqual(splitMorae('しょうねん'), ['しょ', 'う', 'ね', 'ん'])
    assert.deepEqual(splitMorae('きって'), ['きっ', 'て'])
    assert.deepEqual(splitMorae('ラーメン'), ['ラー', 'メ', 'ン'])
  })
})

describe('words timed beat by beat', () => {
  it('tells the time inside a word from its beats', () => {
    // Half way through the text is half way through the beats: the start of め.
    assert.equal(wordTimeAt(unmei, 1), 1200)
    assert.equal(wordTimeAt(unmei, 0), 1000)
    assert.equal(wordTimeAt(unmei, 2), 2000)
  })

  it('lays each kanji out on its own beats, and the reading beat by beat', () => {
    const [chunk] = layoutLine([unmei], [{ text: '運命', ruby: 'うんめい' }])
    assert.deepEqual(chunk.pieces, [{ text: '運', begin: 1000, end: 1200 }, { text: '命', begin: 1200, end: 2000 }])
    assert.deepEqual(chunk.rubyPieces?.map(piece => [piece.text, piece.begin, piece.end]), [['う', 1000, 1100], ['ん', 1100, 1200], ['め', 1200, 1300], ['い', 1300, 2000]])
  })

  it('moves the beats with the line', () => {
    const moved = shiftCue({ id: 'a', words: [unmei] }, 500)
    assert.deepEqual(moved.words[0].syllables?.map(syllable => syllable.begin), [1500, 1600, 1700, 1800])
  })
})
