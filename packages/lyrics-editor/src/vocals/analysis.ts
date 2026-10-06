import type { Peaks } from '../core/waveform.js'

/**
 * What vocal separation leaves for timing: how loud the vocals are frame by frame, the mix
 * alongside for comparison, and the vocals' waveform to draw over the song's. Loudness is in
 * unnormalized dB, so only differences within one song mean anything.
 */
export interface VocalAnalysis {
  model: string
  /** Frames a second (sample rate / hop). */
  frameRate: number
  vocalDb: Float32Array
  mixDb: Float32Array
  peaks: Peaks
}

const MAGIC = 0x41_56_41_31 // "AVA1"

interface Header {
  model: string
  frameRate: number
  frames: number
  peakRate: number
  peakCount: number
}

/** Packs an analysis for storage: a small JSON header, then the arrays as float32. */
export function encodeVocalAnalysis(analysis: VocalAnalysis): ArrayBuffer {
  const header: Header = {
    model: analysis.model,
    frameRate: analysis.frameRate,
    frames: analysis.vocalDb.length,
    peakRate: analysis.peaks.rate,
    peakCount: analysis.peaks.min.length,
  }
  const json = new TextEncoder().encode(JSON.stringify(header))
  // Keeps the arrays that follow 4-byte aligned, so they can be read in place.
  const headerBytes = Math.ceil((8 + json.length) / 4) * 4
  const arrays = [analysis.vocalDb, analysis.mixDb, analysis.peaks.min, analysis.peaks.max]
  const buffer = new ArrayBuffer(headerBytes + arrays.reduce((sum, array) => sum + array.byteLength, 0))
  const view = new DataView(buffer)
  view.setUint32(0, MAGIC)
  view.setUint32(4, json.length)
  new Uint8Array(buffer, 8, json.length).set(json)
  let offset = headerBytes
  for (const array of arrays) {
    new Float32Array(buffer, offset, array.length).set(array)
    offset += array.byteLength
  }
  return buffer
}

/** Reads what `encodeVocalAnalysis` wrote; null for anything else. */
export function decodeVocalAnalysis(buffer: ArrayBuffer): VocalAnalysis | null {
  if (buffer.byteLength < 8) {
    return null
  }
  const view = new DataView(buffer)
  if (view.getUint32(0) !== MAGIC) {
    return null
  }
  const length = view.getUint32(4)
  let header: Header
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length))) as Header
  }
  catch {
    return null
  }
  let offset = Math.ceil((8 + length) / 4) * 4
  if (buffer.byteLength !== offset + 4 * (2 * header.frames + 2 * header.peakCount)) {
    return null
  }
  const take = (count: number): Float32Array => {
    const array = new Float32Array(buffer.slice(offset, offset + count * 4))
    offset += count * 4
    return array
  }
  const vocalDb = take(header.frames)
  const mixDb = take(header.frames)
  const min = take(header.peakCount)
  const max = take(header.peakCount)
  return { model: header.model, frameRate: header.frameRate, vocalDb, mixDb, peaks: { rate: header.peakRate, min, max } }
}
