import { describe, expect, it } from 'vitest'
import { readingRanges } from '../src/readings'

describe('readingranges', () => {
  const runs = [{ text: '外', ruby: 'そと' }, { text: 'を見るともう' }, { text: '明', ruby: 'あか' }, { text: 'るいよね' }]

  it('places readings in the text', () => {
    expect(readingRanges('外を見るともう明るいよね', runs)).toEqual([{ start: 0, end: 1, reading: 'そと' }, { start: 7, end: 8, reading: 'あか' }])
  })

  it('tolerates a space gained or lost since', () => {
    expect(readingRanges('外を見るともう 明るいよね', runs)).toEqual([{ start: 0, end: 1, reading: 'そと' }, { start: 8, end: 9, reading: 'あか' }])
  })

  it('gives nothing for other text', () => {
    expect(readingRanges('外を見る', runs)).toEqual([])
    expect(readingRanges('内を見るともう明るいよね', runs)).toEqual([])
  })
})
