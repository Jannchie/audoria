import type { MdxParams } from './models'

export type BackendChoice = 'auto' | 'webgpu' | 'wasm'

export type ModelSource
  = | { kind: 'url', url: string }
    | { kind: 'file', name: string, buffer: ArrayBuffer }

export interface RunRequest {
  type: 'run'
  left: Float32Array
  right: Float32Array
  sampleRate: number
  model: ModelSource
  params: MdxParams
  backend: BackendChoice
  /** Frames discarded on each side of a chunk (except at the song edges). */
  margin: number
}

export type ToWorker = RunRequest | { type: 'cancel' }

export type FromWorker
  = | { type: 'ready', ortVersion: string, numThreads: number, crossOriginIsolated: boolean }
    | { type: 'status', message: string }
    | { type: 'download', loaded: number, total: number }
    | { type: 'model', source: 'network' | 'cache' | 'file', bytes: number, ms: number }
    | { type: 'session', backend: 'webgpu' | 'wasm', ms: number, reused: boolean, fallbackError?: string, numThreads: number, inputShape: string }
    | { type: 'plan', frames: number, frameRate: number, chunks: number }
    | { type: 'chunk', index: number, start: number, vocalDb: Float32Array, mixDb: Float32Array, stftMs: number, inferMs: number, istftMs: number }
    /** The separated audio at the input's sample rate; instrumental is the mix minus the vocals. */
    | { type: 'stems', sampleRate: number, vocals: [Float32Array, Float32Array], instrumental: [Float32Array, Float32Array], ms: number }
    | { type: 'done', totalMs: number }
    | { type: 'cancelled' }
    | { type: 'error', message: string }
