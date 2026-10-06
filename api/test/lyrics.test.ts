import type { LyricsDoc } from '@audoria/lyrics-core'
import assert from 'node:assert/strict'
// The api package has no vitest dependency; it runs on the built-in runner.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { lyricsDocFromText } from '@audoria/lyrics-core'
import { annotateLyricsFurigana } from '../src/furigana.js'
import { lyricsColumnsFromDoc, lyricsColumnsFromEdit, lyricsColumnsFromText, readLyricsDoc } from '../src/lyrics/store.js'

describe('annotateLyricsFurigana', () => {
  it('keys readings by cue id and puts hand-set readings ahead of the analyzer', async () => {
    const doc = lyricsDocFromText('[00:01.00]運命(さだめ)を見る\n[00:01.00]看命运\n[00:02.00]ABC')!
    const lines = await annotateLyricsFurigana(doc)
    assert.deepEqual(Object.keys(lines), ['c0'])
    assert.deepEqual(lines.c0, [
      { text: '運命', ruby: 'さだめ', explicit: true },
      { text: 'を' },
      { text: '見', ruby: 'み' },
      { text: 'る' },
    ])
  })
})

describe('lyrics columns', () => {
  it('stores a document with its LRC rendering, and an empty one as no lyrics', () => {
    const doc = lyricsDocFromText('[00:01.00]運命(さだめ)\n[00:02.00]x')!
    assert.deepEqual(lyricsColumnsFromDoc(doc), { lyrics: '[00:01.000]運命(さだめ)\n[00:02.000]x', lyricsDoc: JSON.stringify(doc) })
    assert.deepEqual(lyricsColumnsFromDoc({ version: 1, timing: 'none', cues: [], tracks: [] }), { lyrics: null, lyricsDoc: null })
    assert.deepEqual(readLyricsDoc(lyricsColumnsFromDoc(doc)), doc)
  })

  it('keeps LRC text as written and turns TTML into a document', () => {
    assert.deepEqual(lyricsColumnsFromText('[00:01.00]a\n[00:02.00]b'), { lyrics: '[00:01.00]a\n[00:02.00]b', lyricsDoc: null })
    const ttml = lyricsColumnsFromText('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1" end="2">a</p></div></body></tt>')
    assert.equal(ttml.lyrics, '[00:01.000]a')
    assert.equal(readLyricsDoc(ttml)?.cues[0].end, 2000)
  })

  it('merges LRC over a word-timed document, keeping unchanged lines', () => {
    const doc: LyricsDoc = {
      version: 1,
      timing: 'word',
      tracks: [],
      cues: [{ id: 'a', begin: 1000, end: 2000, words: [{ text: 'x', begin: 1000, end: 1500 }, { text: 'y', begin: 1500, end: 2000 }] }],
    }
    const row = lyricsColumnsFromDoc(doc)
    const merged = readLyricsDoc(lyricsColumnsFromEdit('[00:01.00]xy\n[00:05.00]new', row))!
    assert.deepEqual(merged.cues[0], doc.cues[0])
    assert.equal(merged.cues[1].begin, 5000)
    assert.deepEqual(lyricsColumnsFromEdit('plain text', row), { lyrics: 'plain text', lyricsDoc: null })
  })
})

describe('annotateLyricsFurigana with spaces', () => {
  it('keeps the spaces, so the readings still spell the line', async () => {
    const doc = lyricsDocFromText('[00:01.00]外を見るともう 明るいよね\n[00:05.00]ね')!
    const lines = await annotateLyricsFurigana(doc)
    assert.equal(lines.c0.map(segment => segment.text).join(''), '外を見るともう 明るいよね')
    assert.deepEqual(lines.c0.find(segment => segment.text === '外'), { text: '外', ruby: 'そと' })
  })
})
