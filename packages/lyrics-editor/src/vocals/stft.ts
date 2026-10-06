import { RealFFT } from './fft.js'

/**
 * Frame-at-a-time STFT equivalent to torch.stft(center=True, pad_mode='reflect',
 * window=hann_window(n_fft) (periodic), normalized=False). Frame t is centred on
 * sample t * hop, so frames can be computed lazily per chunk.
 */
export class Stft {
  readonly nFft: number
  readonly hop: number
  private readonly fft: RealFFT
  private readonly window: Float64Array
  private readonly seg: Float64Array

  constructor(nFft: number, hop: number) {
    this.nFft = nFft
    this.hop = hop
    this.fft = new RealFFT(nFft)
    this.window = new Float64Array(nFft)
    for (let i = 0; i < nFft; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nFft)
    }
    this.seg = new Float64Array(nFft)
  }

  frameCount(samples: number): number {
    return 1 + Math.floor(samples / this.hop)
  }

  /** Writes the first `bins` bins of frame `frame` into re/im. */
  frame(x: Float32Array | Float64Array, frame: number, re: Float32Array | Float64Array, im: Float32Array | Float64Array, bins: number): void {
    const n = x.length
    const start = frame * this.hop - this.nFft / 2
    const seg = this.seg
    const win = this.window
    if (start >= 0 && start + this.nFft <= n) {
      for (let t = 0; t < this.nFft; t++) {
        seg[t] = x[start + t] * win[t]
      }
    }
    else {
      for (let t = 0; t < this.nFft; t++) {
        let i = start + t
        if (i < 0) {
          i = -i
        }
        if (i >= n) {
          i = 2 * (n - 1) - i
        }
        // Clips too-short inputs where a single reflection isn't enough.
        seg[t] = i >= 0 && i < n ? x[i] * win[t] : 0
      }
    }
    this.fft.forward(seg, re, im, bins)
  }
}

/**
 * Inverse of `Stft` by weighted overlap-add, as torch.istft(center=True): each frame's
 * inverse transform is windowed again and added in, and the sum is divided by the summed
 * squared window. Frames may come in any order; `finish` normalizes once all are in.
 */
export class Istft {
  readonly output: Float32Array
  private readonly nFft: number
  private readonly hop: number
  private readonly fft: RealFFT
  private readonly window: Float64Array
  private readonly frameBuf: Float64Array
  private readonly weight: Float32Array

  constructor(nFft: number, hop: number, samples: number, weight?: Float32Array) {
    this.nFft = nFft
    this.hop = hop
    this.fft = new RealFFT(nFft)
    this.window = new Float64Array(nFft)
    for (let i = 0; i < nFft; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nFft)
    }
    this.frameBuf = new Float64Array(nFft)
    this.output = new Float32Array(samples)
    // Channels sharing a frame layout can share the summed window.
    this.weight = weight ?? new Float32Array(samples)
  }

  get windowSum(): Float32Array {
    return this.weight
  }

  /** Adds frame `frame` given its bins from 0 (missing high bins count as zero). */
  add(frame: number, re: ArrayLike<number>, im: ArrayLike<number>, accumulateWeight = true): void {
    this.fft.inverse(re, im, this.frameBuf)
    const start = frame * this.hop - this.nFft / 2
    const from = Math.max(0, -start)
    const to = Math.min(this.nFft, this.output.length - start)
    for (let t = from; t < to; t++) {
      const w = this.window[t]
      this.output[start + t] += this.frameBuf[t] * w
      if (accumulateWeight) {
        this.weight[start + t] += w * w
      }
    }
  }

  finish(): Float32Array {
    for (let i = 0; i < this.output.length; i++) {
      const w = this.weight[i]
      this.output[i] = w > 1e-8 ? this.output[i] / w : 0
    }
    return this.output
  }
}
