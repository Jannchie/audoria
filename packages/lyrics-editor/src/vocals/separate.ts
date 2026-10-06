import type { VocalAnalysis } from './analysis.js'
import type { VocalModel } from './model.js'
import type { FromSeparator, SeparateRequest } from './protocol.js'
import { MODEL_CACHE, VOCAL_MODEL } from './model.js'

const SAMPLE_RATE = 44_100

export interface SeparationProgress {
  /** Downloading the model (the first time only), then separating. */
  phase: 'model' | 'separating'
  /** 0..1 within the phase. */
  fraction: number
}

/**
 * Separates the vocals of an encoded song (mp3, m4a, flac...) in a worker. The model is fetched
 * once and kept in the Cache API. Aborting stops the worker.
 */
export async function separateVocals(data: ArrayBuffer, options: {
  onProgress?: (progress: SeparationProgress) => void
  signal?: AbortSignal
  model?: VocalModel
} = {}): Promise<VocalAnalysis> {
  const model = options.model ?? VOCAL_MODEL
  // The model is trained on 44.1 kHz stereo; decoding resamples, and mono plays on both sides.
  const buffer = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(data)
  const left = new Float32Array(buffer.getChannelData(0))
  const right = new Float32Array(buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0))

  const worker = new Worker(new URL('worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<VocalAnalysis>((resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
      worker.addEventListener('error', event => reject(new Error(event.message)))
      worker.addEventListener('message', (event: MessageEvent<FromSeparator>) => {
        const message = event.data
        switch (message.type) {
          case 'model': {
            options.onProgress?.({ phase: 'model', fraction: message.total ? message.loaded / message.total : 0 })
            break
          }
          case 'progress': {
            options.onProgress?.({ phase: 'separating', fraction: message.done / message.total })
            break
          }
          case 'done': {
            resolve({
              model: model.name,
              frameRate: message.frameRate,
              vocalDb: message.vocalDb,
              mixDb: message.mixDb,
              peaks: { rate: message.peakRate, min: message.peakMin, max: message.peakMax },
            })
            break
          }
          case 'error': {
            reject(new Error(message.message))
            break
          }
        }
      })
      const request: SeparateRequest = { left, right, sampleRate: SAMPLE_RATE, modelUrl: model.url, modelCache: MODEL_CACHE, params: model.params }
      worker.postMessage(request, [left.buffer, right.buffer])
    })
  }
  finally {
    worker.terminate()
  }
}
