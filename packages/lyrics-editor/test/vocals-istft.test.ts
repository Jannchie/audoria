import { describe, expect, it } from 'vitest'
import { RealFFT } from '../src/vocals/fft'
import { Istft, Stft } from '../src/vocals/stft'

function randomSignal(n: number, seed: number): Float64Array {
  let state = seed
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    out[i] = state / 2 ** 32 * 2 - 1
  }
  return out
}

function maxError(a: Float32Array | Float64Array, b: Float64Array): number {
  let worst = 0
  for (const [i, value] of a.entries()) {
    worst = Math.max(worst, Math.abs(value - b[i]))
  }
  return worst
}

describe('realfft.inverse', () => {
  for (const n of [7680, 6144, 4096, 30]) {
    it(`undoes forward for n=${n}`, () => {
      const fft = new RealFFT(n)
      const x = randomSignal(n, n)
      const re = new Float64Array(n / 2 + 1)
      const im = new Float64Array(n / 2 + 1)
      fft.forward(x, re, im)
      const back = new Float64Array(n)
      fft.inverse(re, im, back)
      expect(maxError(back, x)).toBeLessThan(1e-9)
    })
  }
})

describe('istft', () => {
  it('rebuilds a signal from all of its frames, in any order', () => {
    const nFft = 7680
    const hop = 1024
    const x = randomSignal(44_100, 7)
    const stft = new Stft(nFft, hop)
    const istft = new Istft(nFft, hop, x.length)
    const re = new Float64Array(nFft / 2 + 1)
    const im = new Float64Array(nFft / 2 + 1)
    const frames = stft.frameCount(x.length)
    for (let f = frames - 1; f >= 0; f--) {
      stft.frame(x, f, re, im, nFft / 2 + 1)
      istft.add(f, re, im)
    }
    expect(maxError(istft.finish(), x)).toBeLessThan(1e-4)
  })
})
