// Mixed-radix complex FFT (Stockham autosort, radix 2/3/4/5 + generic) and a real FFT
// built on a half-size complex transform. n_fft 7680 = 2^9 * 3 * 5 rules out a
// power-of-two-only FFT.

function factorize(n: number): number[] {
  const factors: number[] = []
  let rest = n
  for (const p of [4, 2, 3, 5]) {
    while (rest % p === 0) {
      factors.push(p)
      rest /= p
    }
  }
  for (let p = 7; rest > 1; p += 2) {
    while (rest % p === 0) {
      factors.push(p)
      rest /= p
    }
  }
  return factors
}

export class ComplexFFT {
  readonly n: number
  private readonly factors: number[]
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly bufRe: Float64Array
  private readonly bufIm: Float64Array
  private readonly tmpRe: Float64Array
  private readonly tmpIm: Float64Array

  constructor(n: number) {
    this.n = n
    this.factors = factorize(n)
    this.cos = new Float64Array(n)
    this.sin = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = -2 * Math.PI * i / n
      this.cos[i] = Math.cos(a)
      this.sin[i] = Math.sin(a)
    }
    this.bufRe = new Float64Array(n)
    this.bufIm = new Float64Array(n)
    const maxRadix = Math.max(1, ...this.factors)
    this.tmpRe = new Float64Array(maxRadix)
    this.tmpIm = new Float64Array(maxRadix)
  }

  /** Forward transform in place (e^{-2πi kt/n}, unnormalized). */
  forward(re: Float64Array, im: Float64Array): void {
    const N = this.n
    let xr = re
    let xi = im
    let yr = this.bufRe
    let yi = this.bufIm
    let n = N
    let s = 1
    for (const r of this.factors) {
      this.stage(r, n, s, xr, xi, yr, yi)
      ;[xr, yr] = [yr, xr]
      ;[xi, yi] = [yi, xi]
      n /= r
      s *= r
    }
    if (xr !== re) {
      re.set(xr)
      im.set(xi)
    }
  }

  // One DIF Stockham stage: sub-length n, stride s, n * s === N.
  private stage(r: number, n: number, s: number, xr: Float64Array, xi: Float64Array, yr: Float64Array, yi: Float64Array): void {
    const N = this.n
    const m = n / r
    const cos = this.cos
    const sin = this.sin
    for (let p = 0; p < m; p++) {
      for (let q = 0; q < s; q++) {
        const inBase = q + s * p
        const outBase = q + s * r * p
        const sm = s * m
        if (r === 2) {
          const ar = xr[inBase]; const ai = xi[inBase]
          const br = xr[inBase + sm]; const bi = xi[inBase + sm]
          const w = (p * s) % N
          yr[outBase] = ar + br
          yi[outBase] = ai + bi
          const dr = ar - br; const di = ai - bi
          yr[outBase + s] = dr * cos[w] - di * sin[w]
          yi[outBase + s] = dr * sin[w] + di * cos[w]
        }
        else if (r === 4) {
          const ar = xr[inBase]; const ai = xi[inBase]
          const br = xr[inBase + sm]; const bi = xi[inBase + sm]
          const cr = xr[inBase + 2 * sm]; const ci = xi[inBase + 2 * sm]
          const dr = xr[inBase + 3 * sm]; const di = xi[inBase + 3 * sm]
          const t0r = ar + cr; const t0i = ai + ci
          const t1r = ar - cr; const t1i = ai - ci
          const t2r = br + dr; const t2i = bi + di
          // (b - d) * -i
          const t3r = bi - di; const t3i = dr - br
          this.put(yr, yi, outBase, t0r + t2r, t0i + t2i, 0)
          this.put(yr, yi, outBase + s, t1r + t3r, t1i + t3i, p * s)
          this.put(yr, yi, outBase + 2 * s, t0r - t2r, t0i - t2i, 2 * p * s)
          this.put(yr, yi, outBase + 3 * s, t1r - t3r, t1i - t3i, 3 * p * s)
        }
        else {
          // Generic O(r^2) DFT butterfly; r is 3, 5 or a larger prime.
          const tr = this.tmpRe
          const ti = this.tmpIm
          for (let k = 0; k < r; k++) {
            tr[k] = xr[inBase + k * sm]
            ti[k] = xi[inBase + k * sm]
          }
          const step = N / r
          for (let j = 0; j < r; j++) {
            let sr = 0
            let si = 0
            for (let k = 0; k < r; k++) {
              const w = ((j * k) % r) * step
              sr += tr[k] * cos[w] - ti[k] * sin[w]
              si += tr[k] * sin[w] + ti[k] * cos[w]
            }
            this.put(yr, yi, outBase + j * s, sr, si, j * p * s)
          }
        }
      }
    }
  }

  private put(yr: Float64Array, yi: Float64Array, at: number, vr: number, vi: number, twiddle: number): void {
    const w = twiddle % this.n
    const c = this.cos[w]
    const sn = this.sin[w]
    yr[at] = vr * c - vi * sn
    yi[at] = vr * sn + vi * c
  }
}

/** Real-input FFT of even length n, returning bins 0..n/2 (inclusive). */
export class RealFFT {
  readonly n: number
  private readonly half: ComplexFFT
  private readonly zr: Float64Array
  private readonly zi: Float64Array
  private readonly wr: Float64Array
  private readonly wi: Float64Array

  constructor(n: number) {
    if (n % 2 !== 0) {
      throw new Error(`RealFFT needs an even length, got ${n}`)
    }
    this.n = n
    const m = n / 2
    this.half = new ComplexFFT(m)
    this.zr = new Float64Array(m)
    this.zi = new Float64Array(m)
    this.wr = new Float64Array(m + 1)
    this.wi = new Float64Array(m + 1)
    for (let k = 0; k <= m; k++) {
      const a = -2 * Math.PI * k / n
      this.wr[k] = Math.cos(a)
      this.wi[k] = Math.sin(a)
    }
  }

  /** outRe/outIm must hold at least `bins` values (bins <= n/2 + 1). */
  forward(input: ArrayLike<number>, outRe: Float64Array | Float32Array, outIm: Float64Array | Float32Array, bins = this.n / 2 + 1): void {
    const m = this.n / 2
    const zr = this.zr
    const zi = this.zi
    for (let k = 0; k < m; k++) {
      zr[k] = input[2 * k]
      zi[k] = input[2 * k + 1]
    }
    this.half.forward(zr, zi)
    for (let k = 0; k < bins; k++) {
      const ar = zr[k % m]; const ai = zi[k % m]
      const j = (m - k) % m
      const br = zr[j]; const bi = -zi[j]
      // Even part (a + conj(b)) / 2, odd part (a - conj(b)) / 2i.
      const er = 0.5 * (ar + br); const ei = 0.5 * (ai + bi)
      const or = 0.5 * (ai - bi); const oi = -0.5 * (ar - br)
      const wr = this.wr[k]; const wi = this.wi[k]
      outRe[k] = er + or * wr - oi * wi
      outIm[k] = ei + or * wi + oi * wr
    }
  }

  /**
   * Inverse of `forward`, normalized (1/n), from bins 0..n/2 (inclusive); bins past the
   * arrays' length count as zero. Runs the half-size complex transform conjugated.
   */
  inverse(inRe: ArrayLike<number>, inIm: ArrayLike<number>, output: Float64Array | Float32Array): void {
    const m = this.n / 2
    const zr = this.zr
    const zi = this.zi
    const bins = Math.min(inRe.length, m + 1)
    const binRe = (k: number): number => k < bins ? inRe[k] : 0
    const binIm = (k: number): number => k < bins ? inIm[k] : 0
    for (let k = 0; k < m; k++) {
      // E = (X[k] + conj(X[m-k])) / 2, O = (X[k] - conj(X[m-k])) * W^-k / 2, Z = E + iO.
      const ar = binRe(k); const ai = binIm(k)
      const br = binRe(m - k); const bi = -binIm(m - k)
      const er = 0.5 * (ar + br); const ei = 0.5 * (ai + bi)
      const dr = 0.5 * (ar - br); const di = 0.5 * (ai - bi)
      const wr = this.wr[k]; const wi = -this.wi[k]
      const or = dr * wr - di * wi; const oi = dr * wi + di * wr
      // Conjugated, so the forward transform computes the inverse.
      zr[k] = er - oi
      zi[k] = -(ei + or)
    }
    this.half.forward(zr, zi)
    for (let k = 0; k < m; k++) {
      output[2 * k] = zr[k] / m
      output[2 * k + 1] = -zi[k] / m
    }
  }
}
