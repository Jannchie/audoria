// Separates the vocals of a song with an UVR MDX-Net model through ONNX Runtime Web, on the GPU
// (WebGPU) where there is one and on the CPU (wasm) otherwise. Runs in a worker, so a minute of
// number crunching never stalls the page.
import type { FromSeparator, SeparateRequest } from './protocol.js'
import * as ort from 'onnxruntime-web/webgpu'
import { computePeaks } from '../core/waveform.js'
import { planChunks, toDb } from './chunks.js'
import { Istft, Stft } from './stft.js'

interface WorkerScope {
  postMessage: (message: FromSeparator, transfer?: Transferable[]) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent<SeparateRequest>) => void) => void
  crossOriginIsolated: boolean
}
const scope = globalThis as unknown as WorkerScope

// The .wasm comes from the CDN copy of the installed version instead of being bundled (~25 MB).
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`
ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1

// Frames dropped at each side of a model window, where it sees too little context.
const MARGIN = 32

scope.addEventListener('message', (event) => {
  separate(event.data).catch((error: unknown) => {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  })
})

async function loadModel(url: string, cacheName: string): Promise<Uint8Array> {
  const cache = typeof caches === 'undefined' ? null : await caches.open(cacheName)
  const hit = await cache?.match(url)
  if (hit) {
    return new Uint8Array(await hit.arrayBuffer())
  }
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`model download failed: HTTP ${response.status}`)
  }
  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    parts.push(value)
    loaded += value.byteLength
    scope.postMessage({ type: 'model', loaded, total })
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  await cache?.put(url, new Response(bytes))
  return bytes
}

async function createSession(bytes: Uint8Array): Promise<ort.InferenceSession> {
  try {
    return await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
  }
  catch {
    return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  }
}

async function separate(request: SeparateRequest): Promise<void> {
  const { nFft, hop, dimF, dimT, compensate } = request.params
  const session = await createSession(await loadModel(request.modelUrl, request.modelCache))
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]

  const stft = new Stft(nFft, hop)
  const frames = stft.frameCount(request.left.length)
  const plan = planChunks(frames, dimT, MARGIN)
  const plane = dimF * dimT
  const input = new Float32Array(4 * plane)
  const re = new Float32Array(dimF)
  const im = new Float32Array(dimF)
  const vocalDb = new Float32Array(frames)
  const mixDb = new Float32Array(frames)
  const channels = [request.left, request.right]
  const left = new Istft(nFft, hop, request.left.length)
  const vocals = [left, new Istft(nFft, hop, request.left.length, left.windowSum)]

  for (const [index, chunk] of plan.entries()) {
    // The model takes [L_re, L_im, R_re, R_im] planes of dimF bins by dimT frames.
    input.fill(0)
    for (let t = 0; t < dimT && chunk.start + t < frames; t++) {
      const frame = chunk.start + t
      let energy = 0
      for (let c = 0; c < 2; c++) {
        stft.frame(channels[c], frame, re, im, dimF)
        const reBase = 2 * c * plane + t
        for (let f = 0; f < dimF; f++) {
          input[reBase + f * dimT] = re[f]
          input[reBase + plane + f * dimT] = im[f]
          energy += re[f] * re[f] + im[f] * im[f]
        }
      }
      if (frame >= chunk.keepStart && frame < chunk.keepEnd) {
        mixDb[frame] = toDb(energy)
      }
    }

    const result = await session.run({ [inputName]: new ort.Tensor('float32', input, [1, 4, dimF, dimT]) })
    const output = result[outputName]
    const out = (await output.getData()) as Float32Array

    for (let frame = chunk.keepStart; frame < chunk.keepEnd; frame++) {
      const t = frame - chunk.start
      let energy = 0
      for (let c = 0; c < 2; c++) {
        const reBase = 2 * c * plane + t
        for (let f = 0; f < dimF; f++) {
          re[f] = out[reBase + f * dimT] * compensate
          im[f] = out[reBase + plane + f * dimT] * compensate
          energy += re[f] * re[f] + im[f] * im[f]
        }
        vocals[c].add(frame, re, im, c === 0)
      }
      vocalDb[frame] = toDb(energy)
    }
    output.dispose()
    scope.postMessage({ type: 'progress', done: index + 1, total: plan.length })
  }
  await session.release()

  const peaks = computePeaks(vocals.map(vocal => vocal.finish()), request.sampleRate)
  scope.postMessage(
    { type: 'done', frameRate: request.sampleRate / hop, vocalDb, mixDb, peakRate: peaks.rate, peakMin: peaks.min, peakMax: peaks.max },
    [vocalDb.buffer, mixDb.buffer, peaks.min.buffer, peaks.max.buffer],
  )
}
