const PEAK_BLOCK = 256
const RULER_H = 22
const DB_RANGE = 60

export interface Envelopes {
  frameRate: number
  vocalDb: Float32Array
  mixDb: Float32Array
}

interface Peaks {
  min: Float32Array
  max: Float32Array
}

/** Min/max of the channels' average over each block of PEAK_BLOCK samples. */
function computePeaks(left: Float32Array, right: Float32Array): Peaks {
  const blocks = Math.ceil(left.length / PEAK_BLOCK)
  const min = new Float32Array(blocks)
  const max = new Float32Array(blocks)
  for (let b = 0; b < blocks; b++) {
    let lo = Infinity
    let hi = -Infinity
    const end = Math.min(left.length, (b + 1) * PEAK_BLOCK)
    for (let i = b * PEAK_BLOCK; i < end; i++) {
      const v = (left[i] + right[i]) / 2
      if (v < lo) {
        lo = v
      }
      if (v > hi) {
        hi = v
      }
    }
    min[b] = lo
    max[b] = hi
  }
  return { min, max }
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function formatTime(seconds: number, step: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  const digits = step < 1 ? 1 : 0
  return `${m}:${s.toFixed(digits).padStart(digits ? 4 : 2, '0')}`
}

/** Waveform + envelope view with wheel zoom, drag pan and click-to-seek. */
export class Viz {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly audio: HTMLAudioElement
  private mixPeaks: Peaks = { min: new Float32Array(0), max: new Float32Array(0) }
  // Drawn inside the mix waveform at the same scale once the vocals are separated.
  private vocalPeaks: Peaks | null = null
  private sampleRate = 44_100
  private duration = 0
  private viewStart = 0
  private viewDur = 1
  private envelopes: Envelopes | null = null
  private dbTop = 0
  private frameRequested = false
  private drag: { x: number, start: number, moved: boolean } | null = null

  constructor(canvas: HTMLCanvasElement, audio: HTMLAudioElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.audio = audio
    new ResizeObserver(() => this.requestDraw()).observe(canvas)
    canvas.addEventListener('wheel', event => this.onWheel(event), { passive: false })
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId)
      this.drag = { x: event.offsetX, start: this.viewStart, moved: false }
    })
    canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) {
        return
      }
      const dx = event.offsetX - this.drag.x
      if (Math.abs(dx) > 3) {
        this.drag.moved = true
      }
      if (this.drag.moved) {
        this.setView(this.drag.start - dx / canvas.clientWidth * this.viewDur, this.viewDur)
      }
    })
    canvas.addEventListener('pointerup', (event) => {
      if (this.drag && !this.drag.moved && this.duration > 0) {
        audio.currentTime = this.timeAt(event.offsetX)
      }
      this.drag = null
    })
    const tick = (): void => {
      this.followPlayhead()
      this.requestDraw()
      if (!audio.paused) {
        requestAnimationFrame(tick)
      }
    }
    audio.addEventListener('play', () => requestAnimationFrame(tick))
    audio.addEventListener('seeked', () => this.requestDraw())
  }

  setAudio(buffer: AudioBuffer): void {
    const left = buffer.getChannelData(0)
    this.mixPeaks = computePeaks(left, buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left)
    this.vocalPeaks = null
    this.sampleRate = buffer.sampleRate
    this.duration = buffer.duration
    this.envelopes = null
    this.setView(0, this.duration)
  }

  /** The separated vocals, or null to drop them. */
  setVocals(vocals: [Float32Array, Float32Array] | null): void {
    this.vocalPeaks = vocals ? computePeaks(...vocals) : null
    this.requestDraw()
  }

  setEnvelopes(envelopes: Envelopes | null): void {
    this.envelopes = envelopes
    this.updateDbTop()
    this.requestDraw()
  }

  /** Call after filling in more envelope frames. */
  envelopesChanged(): void {
    this.updateDbTop()
    this.requestDraw()
  }

  private updateDbTop(): void {
    let top = -Infinity
    if (this.envelopes) {
      for (const arr of [this.envelopes.mixDb, this.envelopes.vocalDb]) {
        for (const v of arr) {
          if (v > top) {
            top = v
          }
        }
      }
    }
    this.dbTop = Number.isFinite(top) ? top : 0
  }

  private timeAt(x: number): number {
    return this.viewStart + x / this.canvas.clientWidth * this.viewDur
  }

  private setView(start: number, dur: number): void {
    const total = Math.max(this.duration, 0.001)
    this.viewDur = Math.min(Math.max(dur, 0.25), total)
    this.viewStart = Math.min(Math.max(start, 0), total - this.viewDur)
    this.requestDraw()
  }

  private onWheel(event: WheelEvent): void {
    if (this.duration <= 0) {
      return
    }
    event.preventDefault()
    const pan = event.shiftKey ? event.deltaY : event.deltaX
    if (Math.abs(pan) > Math.abs(event.shiftKey ? 0 : event.deltaY)) {
      this.setView(this.viewStart + pan / this.canvas.clientWidth * this.viewDur, this.viewDur)
      return
    }
    const anchor = this.timeAt(event.offsetX)
    const factor = Math.exp(event.deltaY * 0.002)
    const dur = this.viewDur * factor
    this.setView(anchor - (anchor - this.viewStart) * (dur / this.viewDur), dur)
  }

  private followPlayhead(): void {
    const t = this.audio.currentTime
    if (t > this.viewStart + this.viewDur || t < this.viewStart) {
      this.setView(t - this.viewDur * 0.1, this.viewDur)
    }
  }

  private requestDraw(): void {
    if (this.frameRequested) {
      return
    }
    this.frameRequested = true
    requestAnimationFrame(() => {
      this.frameRequested = false
      this.draw()
    })
  }

  private draw(): void {
    const { canvas, ctx } = this
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (this.duration <= 0) {
      return
    }

    const pxPerSec = w / this.viewDur
    this.drawRuler(w, pxPerSec)

    const top = RULER_H + 4
    const height = h - top - 4
    const mid = top + height / 2

    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
    this.drawWave(this.mixPeaks, w, pxPerSec, mid, height)
    if (this.vocalPeaks) {
      ctx.fillStyle = css('--vocal')
      ctx.globalAlpha = 0.85
      this.drawWave(this.vocalPeaks, w, pxPerSec, mid, height)
      ctx.globalAlpha = 1
    }

    if (this.envelopes) {
      ctx.lineWidth = 1.25
      ctx.globalAlpha = 0.55
      this.drawEnvelope(this.envelopes.mixDb, css('--mix'), w, pxPerSec, top, height)
      ctx.globalAlpha = 1
      ctx.lineWidth = 1.5
      this.drawEnvelope(this.envelopes.vocalDb, css('--vocal'), w, pxPerSec, top, height)
      ctx.fillStyle = css('--text-tertiary')
      ctx.font = `10px ${css('--font-mono')}`
      ctx.textAlign = 'right'
      ctx.fillText(`${this.dbTop.toFixed(0)} dB`, w - 4, top + 10)
      ctx.fillText(`${(this.dbTop - DB_RANGE).toFixed(0)} dB`, w - 4, top + height - 2)
    }

    const px = (this.audio.currentTime - this.viewStart) * pxPerSec
    if (px >= 0 && px <= w) {
      ctx.fillStyle = css('--accent')
      ctx.fillRect(Math.round(px), 0, 1.5, h)
    }
  }

  /** Min/max of the peak blocks under each pixel column. */
  private drawWave(peaks: Peaks, w: number, pxPerSec: number, mid: number, height: number): void {
    const blocksPerSec = this.sampleRate / PEAK_BLOCK
    for (let x = 0; x < w; x++) {
      const b0 = Math.floor((this.viewStart + x / pxPerSec) * blocksPerSec)
      const b1 = Math.max(b0 + 1, Math.floor((this.viewStart + (x + 1) / pxPerSec) * blocksPerSec))
      let lo = 0
      let hi = 0
      for (let b = b0; b < b1 && b < peaks.min.length; b++) {
        lo = Math.min(lo, peaks.min[b])
        hi = Math.max(hi, peaks.max[b])
      }
      const y0 = mid - hi * height / 2
      const y1 = mid - lo * height / 2
      this.ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
  }

  private drawRuler(w: number, pxPerSec: number): void {
    const { ctx } = this
    ctx.fillStyle = css('--bg-elevated')
    ctx.fillRect(0, 0, w, RULER_H)
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
    const step = steps.find(s => s * pxPerSec >= 70) ?? 600
    ctx.fillStyle = css('--text-tertiary')
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.font = `10px ${css('--font-mono')}`
    ctx.textAlign = 'left'
    ctx.beginPath()
    for (let t = Math.ceil(this.viewStart / step) * step; t <= this.viewStart + this.viewDur; t += step) {
      const x = Math.round((t - this.viewStart) * pxPerSec) + 0.5
      ctx.moveTo(x, RULER_H - 6)
      ctx.lineTo(x, RULER_H)
      ctx.fillText(formatTime(t, step), x + 3, 13)
    }
    ctx.stroke()
  }

  private drawEnvelope(db: Float32Array, color: string, w: number, pxPerSec: number, top: number, height: number): void {
    const { ctx } = this
    const rate = this.envelopes!.frameRate
    const floor = this.dbTop - DB_RANGE
    ctx.strokeStyle = color
    ctx.beginPath()
    let penDown = false
    for (let x = 0; x < w; x++) {
      const f0 = Math.floor((this.viewStart + x / pxPerSec) * rate)
      const f1 = Math.max(f0 + 1, Math.floor((this.viewStart + (x + 1) / pxPerSec) * rate))
      // Max over the frames in this column keeps short peaks visible when zoomed out.
      let v = -Infinity
      for (let f = f0; f < f1 && f < db.length; f++) {
        if (db[f] > v) {
          v = db[f]
        }
      }
      if (!Number.isFinite(v)) {
        penDown = false
        continue
      }
      const norm = Math.min(1, Math.max(0, (v - floor) / DB_RANGE))
      const y = top + height - norm * height
      if (penDown) {
        ctx.lineTo(x, y)
      }
      else {
        ctx.moveTo(x, y)
        penDown = true
      }
    }
    ctx.stroke()
  }
}
