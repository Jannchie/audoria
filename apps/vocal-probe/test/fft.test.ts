import { describe, expect, it } from 'vitest'
import { ComplexFFT, RealFFT } from '../src/fft'
import { Stft } from '../src/stft'

function naiveDft(x: ArrayLike<number>, bins: number): { re: Float64Array, im: Float64Array } {
  const n = x.length
  const re = new Float64Array(bins)
  const im = new Float64Array(bins)
  for (let k = 0; k < bins; k++) {
    let sr = 0
    let si = 0
    for (let t = 0; t < n; t++) {
      // Reduce the angle index first so large k * t stays exact.
      const a = -2 * Math.PI * ((k * t) % n) / n
      sr += x[t] * Math.cos(a)
      si += x[t] * Math.sin(a)
    }
    re[k] = sr
    im[k] = si
  }
  return { re, im }
}

function randomSignal(n: number, seed: number): Float64Array {
  let state = seed
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    out[i] = state / 2 ** 32 * 2 - 1
  }
  return out
}

function maxRelativeError(aRe: ArrayLike<number>, aIm: ArrayLike<number>, bRe: ArrayLike<number>, bIm: ArrayLike<number>, count: number): number {
  let maxErr = 0
  let maxMag = 0
  for (let k = 0; k < count; k++) {
    maxErr = Math.max(maxErr, Math.hypot(aRe[k] - bRe[k], aIm[k] - bIm[k]))
    maxMag = Math.max(maxMag, Math.hypot(bRe[k], bIm[k]))
  }
  return maxErr / maxMag
}

describe('fft', () => {
  for (const n of [7680, 6144, 4096]) {
    it(`real FFT matches a naive DFT for n=${n}`, () => {
      const x = randomSignal(n, n)
      const bins = n / 2 + 1
      const ref = naiveDft(x, bins)
      const re = new Float64Array(bins)
      const im = new Float64Array(bins)
      new RealFFT(n).forward(x, re, im)
      expect(maxRelativeError(re, im, ref.re, ref.im, bins)).toBeLessThan(1e-3)
      // Per-bin check too, so a single wrong bin can't hide behind the peak magnitude.
      for (const k of [0, 1, 7, n / 4, n / 2 - 1, n / 2]) {
        expect(re[k]).toBeCloseTo(ref.re[k], 6)
        expect(im[k]).toBeCloseTo(ref.im[k], 6)
      }
    })
  }

  for (const n of [3840, 2048, 15, 60, 7 * 9]) {
    it(`complex FFT matches a naive DFT for n=${n}`, () => {
      const xr = randomSignal(n, 1)
      const xi = randomSignal(n, 2)
      const re = new Float64Array(n)
      const im = new Float64Array(n)
      for (let k = 0; k < n; k++) {
        let sr = 0
        let si = 0
        for (let t = 0; t < n; t++) {
          const a = -2 * Math.PI * ((k * t) % n) / n
          sr += xr[t] * Math.cos(a) - xi[t] * Math.sin(a)
          si += xr[t] * Math.sin(a) + xi[t] * Math.cos(a)
        }
        re[k] = sr
        im[k] = si
      }
      const yr = Float64Array.from(xr)
      const yi = Float64Array.from(xi)
      new ComplexFFT(n).forward(yr, yi)
      expect(maxRelativeError(yr, yi, re, im, n)).toBeLessThan(1e-9)
    })
  }
})

describe('stft', () => {
  it('matches torch.stft framing (center, reflect pad, periodic hann)', () => {
    const nFft = 64
    const hop = 16
    const x = randomSignal(200, 3)
    const stft = new Stft(nFft, hop)
    expect(stft.frameCount(x.length)).toBe(1 + Math.floor(200 / hop))
    const bins = 10
    const re = new Float32Array(bins)
    const im = new Float32Array(bins)
    for (const frame of [0, 1, 6, 12]) {
      stft.frame(x, frame, re, im, bins)
      const seg = new Float64Array(nFft)
      for (let t = 0; t < nFft; t++) {
        let i = frame * hop - nFft / 2 + t
        if (i < 0) {
          i = -i
        }
        if (i >= x.length) {
          i = 2 * (x.length - 1) - i
        }
        seg[t] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / nFft))
      }
      const ref = naiveDft(seg, bins)
      expect(maxRelativeError(re, im, ref.re, ref.im, bins)).toBeLessThan(1e-5)
    }
  })
})
