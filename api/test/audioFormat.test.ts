import assert from 'node:assert/strict'
// The api package has no vitest dependency; it runs on the built-in runner.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { sniffAudioFormat, withAudioExtension } from '../src/audioFormat.js'

function bytes(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = []
  for (const part of parts) {
    out.push(...(typeof part === 'string' ? [...part].map(char => char.charCodeAt(0)) : part))
  }
  while (out.length < 64) {
    out.push(0)
  }
  return new Uint8Array(out)
}

describe('sniffAudioFormat', () => {
  it('detects FLAC regardless of the name or type it was imported with', () => {
    assert.deepEqual(sniffAudioFormat(bytes('fLaC')), { contentType: 'audio/flac', ext: '.flac' })
  })

  it('detects MP3 with an ID3 tag or a bare frame header', () => {
    assert.deepEqual(sniffAudioFormat(bytes('ID3')), { contentType: 'audio/mpeg', ext: '.mp3' })
    assert.deepEqual(sniffAudioFormat(bytes([0xFF, 0xFB, 0x90])), { contentType: 'audio/mpeg', ext: '.mp3' })
  })

  it('tells ADTS AAC apart from MPEG audio', () => {
    assert.deepEqual(sniffAudioFormat(bytes([0xFF, 0xF1, 0x50])), { contentType: 'audio/aac', ext: '.aac' })
  })

  it('detects MP4, Ogg, Opus and WAV', () => {
    assert.deepEqual(sniffAudioFormat(bytes([0, 0, 0, 0x20], 'ftypM4A ')), { contentType: 'audio/mp4', ext: '.m4a' })
    assert.deepEqual(sniffAudioFormat(bytes('OggS')), { contentType: 'audio/ogg', ext: '.ogg' })
    assert.deepEqual(sniffAudioFormat(bytes('OggS', Array.from({ length: 24 }).fill(0) as number[], 'OpusHead')), { contentType: 'audio/ogg', ext: '.opus' })
    assert.deepEqual(sniffAudioFormat(bytes('RIFF', [0, 0, 0, 0], 'WAVE')), { contentType: 'audio/wav', ext: '.wav' })
  })

  it('returns null for content that is not audio', () => {
    assert.equal(sniffAudioFormat(bytes('Internal Server Error')), null)
  })
})

describe('withAudioExtension', () => {
  it('replaces the extension and keeps dots inside the name', () => {
    assert.equal(withAudioExtension('駅 - 德永英明.mp3', '.flac'), '駅 - 德永英明.flac')
    assert.equal(withAudioExtension('Dr. Stone.mp3', '.flac'), 'Dr. Stone.flac')
    assert.equal(withAudioExtension('audio', '.flac'), 'audio.flac')
  })
})
