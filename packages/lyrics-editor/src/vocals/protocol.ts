import type { MdxParams } from './model.js'

export interface SeparateRequest {
  left: Float32Array
  right: Float32Array
  sampleRate: number
  modelUrl: string
  modelCache: string
  params: MdxParams
}

export type FromSeparator
  = | { type: 'model', loaded: number, total: number }
    | { type: 'progress', done: number, total: number }
    | { type: 'done', frameRate: number, vocalDb: Float32Array, mixDb: Float32Array, peakRate: number, peakMin: Float32Array, peakMax: Float32Array }
    | { type: 'error', message: string }
