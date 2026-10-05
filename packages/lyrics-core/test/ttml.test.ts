import type { LyricsDoc } from '../src/index.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { looksLikeTtml, lyricsDocFromText, lyricsDocFromTtml, lyricsDocToTtml, parseTtmlTime, TtmlParseError } from '../src/index.js'

// Shaped like the AMLL documentation's examples: pretty-printed, inline roles, a sidecar.
const AMLL_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:tts="http://www.w3.org/ns/ttml#styling"
    itunes:timing="Word" xml:lang="ja">
  <head>
    <metadata>
      <ttm:agent type="person" xml:id="v1"/>
      <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
        <translations>
          <translation xml:lang="zh-Hans" type="subtitle">
            <text for="L1">这是</text>
          </translation>
        </translations>
      </iTunesMetadata>
    </metadata>
  </head>
  <body>
    <div itunes:song-part="Verse">
      <p begin="00:10.000" end="00:12.000" itunes:key="L1" ttm:agent="v1">
        <span begin="00:10.000" end="00:10.500">こ</span>
        <span begin="00:10.500" end="00:11.000">れ</span>
        <span begin="00:11.000" end="00:12.000">は</span>
      </p>
      <p begin="20.000" end="25.000" itunes:key="L2" ttm:agent="v1000">
        <span tts:ruby="container">
          <span tts:ruby="base">所</span>
          <span tts:ruby="textContainer">
            <span tts:ruby="text" begin="00:20.000" end="00:20.400">しょ</span>
          </span>
        </span>
        <span begin="20.4s" end="21.5s">です</span>
        <span ttm:role="x-translation" xml:lang="en">It is</span>
        <span ttm:role="x-bg" begin="22.500" end="23.800">
          <span begin="22.500" end="23.800">(背景)</span>
          <span ttm:role="x-translation" xml:lang="en">Background</span>
        </span>
      </p>
    </div>
  </body>
</tt>`

describe('parseTtmlTime', () => {
  it('reads clock and offset times', () => {
    assert.equal(parseTtmlTime('01:02:03.5'), 3_723_500)
    assert.equal(parseTtmlTime('1:02.25'), 62_250)
    assert.equal(parseTtmlTime('12.3'), 12_300)
    assert.equal(parseTtmlTime('12.3s'), 12_300)
    assert.equal(parseTtmlTime('250ms'), 250)
    // Frame counts need a frame rate, which lyrics files don't give.
    assert.equal(parseTtmlTime('00:00:01:12'), undefined)
    assert.equal(parseTtmlTime('soon'), undefined)
  })
})

describe('lyricsDocFromTtml', () => {
  it('reads word timing, readings, agents, backing vocals and both translation styles', () => {
    assert.deepEqual(lyricsDocFromTtml(AMLL_SAMPLE), {
      version: 1,
      timing: 'word',
      lang: 'ja',
      cues: [
        {
          id: 'c0',
          begin: 10_000,
          end: 12_000,
          agent: 'v1',
          words: [{ text: 'こ', begin: 10_000, end: 10_500 }, { text: 'れ', begin: 10_500, end: 11_000 }, { text: 'は', begin: 11_000, end: 12_000 }],
        },
        {
          id: 'c1',
          begin: 20_000,
          end: 25_000,
          agent: 'v1000',
          words: [{ text: '所', begin: 20_000, end: 20_400 }, { text: 'です', begin: 20_400, end: 21_500 }],
          background: [{ text: '(背景)', begin: 22_500, end: 23_800 }],
          ruby: [{ start: 0, end: 1, reading: 'しょ' }],
        },
      ],
      tracks: [
        { lang: 'en', kind: 'translation', lines: { c1: 'It is' } },
        { lang: 'zh-Hans', kind: 'translation', lines: { c0: '这是' } },
      ],
    })
  })

  it('keeps the spaces between word spans with the word before them', () => {
    const doc = lyricsDocFromTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1" end="3"><span begin="1" end="1.5">Hel</span><span begin="1.5" end="2">lo</span> <span begin="2" end="3">world</span></p></div></body></tt>')
    assert.deepEqual(doc.cues[0].words.map(word => word.text), ['Hel', 'lo ', 'world'])
  })

  it('reads line-timed and untimed files', () => {
    const line = lyricsDocFromTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:01.000" end="00:02.000">Hello  there</p></div></body></tt>')
    assert.equal(line.timing, 'line')
    assert.deepEqual(line.cues[0], { id: 'c0', begin: 1000, end: 2000, words: [{ text: 'Hello there' }] })
    const plain = lyricsDocFromTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>Hello</p></div></body></tt>')
    assert.equal(plain.timing, 'none')
  })

  it('rejects malformed XML and documents that are not TTML', () => {
    assert.throws(() => lyricsDocFromTtml('<tt><body>'), TtmlParseError)
    assert.throws(() => lyricsDocFromTtml('<html/>'), TtmlParseError)
  })
})

describe('lyricsDocToTtml', () => {
  it('round-trips a word-timed document', () => {
    const doc: LyricsDoc = {
      version: 1,
      timing: 'word',
      lang: 'ja',
      cues: [
        {
          id: 'c0',
          begin: 1000,
          end: 3000,
          agent: 'v1',
          words: [{ text: '運命', begin: 1000, end: 1600 }, { text: 'の ', begin: 1600, end: 2000 }, { text: 'A&B', begin: 2000, end: 3000 }],
          background: [{ text: '(ah)', begin: 2500, end: 3000 }],
          ruby: [{ start: 0, end: 2, reading: 'さだめ' }],
        },
        { id: 'c1', begin: 4000, end: 5000, agent: 'v2', words: [] },
      ],
      tracks: [
        { lang: 'zh', kind: 'translation', lines: { c0: '命运' } },
        { lang: 'ja-Latn', kind: 'transliteration', lines: { c0: 'sadame no' } },
      ],
    }
    const ttml = lyricsDocToTtml(doc, { title: 'Song' })
    assert.match(ttml, /itunes:timing="Word"/)
    assert.match(ttml, /<amll:meta key="musicName" value="Song"\/>/)
    assert.deepEqual(lyricsDocFromTtml(ttml), doc)
  })

  it('round-trips a line-timed document with readings', () => {
    const doc = lyricsDocFromTtml(lyricsDocToTtml(lyricsDocFromText('[00:01.00]運命(さだめ)の今\n[00:01.00]命运的现在\n[00:05.00]外を見る')!))
    assert.deepEqual(doc, {
      version: 1,
      timing: 'line',
      lang: 'ja',
      cues: [
        { id: 'c0', begin: 1000, end: 5000, words: [{ text: '運命の今' }], ruby: [{ start: 0, end: 2, reading: 'さだめ' }] },
        { id: 'c1', begin: 5000, words: [{ text: '外を見る' }] },
      ],
      tracks: [{ lang: 'zh', kind: 'translation', lines: { c0: '命运的现在' } }],
    })
  })

  it('splits a word around a reading that covers only part of it, sharing out its time', () => {
    const doc: LyricsDoc = {
      version: 1,
      timing: 'word',
      cues: [{ id: 'c0', begin: 0, end: 400, words: [{ text: '取り', begin: 0, end: 400 }], ruby: [{ start: 0, end: 1, reading: 'と' }] }],
      tracks: [],
    }
    assert.deepEqual(lyricsDocFromTtml(lyricsDocToTtml(doc)).cues[0].words, [{ text: '取', begin: 0, end: 200 }, { text: 'り', begin: 200, end: 400 }])
  })

  it('is recognized as TTML', () => {
    assert.ok(looksLikeTtml(lyricsDocToTtml({ version: 1, timing: 'none', cues: [], tracks: [] })))
    assert.ok(!looksLikeTtml('[00:01.00]line'))
  })
})
