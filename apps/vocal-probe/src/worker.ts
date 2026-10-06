/// <reference lib="webworker" />
import type { BackendChoice, FromWorker, ModelSource, RunRequest, ToWorker } from './protocol'
import * as ort from 'onnxruntime-web/webgpu'
import { planChunks, toDb } from './chunks'
import { MODEL_CACHE_NAME } from './models'
import { Istft, Stft } from './stft'

declare const self: DedicatedWorkerGlobalScope

// The .wasm (and its loader) come from the CDN copy of the exact installed version.
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1

let cancelled = false
let busy = false
let cached: { key: string, backend: 'webgpu' | 'wasm', session: ort.InferenceSession } | null = null

function post(message: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer)
}

post({ type: 'ready', ortVersion: ort.env.versions.web ?? '?', numThreads: ort.env.wasm.numThreads ?? 1, crossOriginIsolated: self.crossOriginIsolated })

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data
  if (message.type === 'cancel') {
    cancelled = true
    return
  }
  if (busy) {
    post({ type: 'error', message: 'already running' })
    return
  }
  busy = true
  cancelled = false
  run(message)
    .catch((error: unknown) => post({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
    .finally(() => {
      busy = false
    })
})

async function loadModel(source: ModelSource): Promise<Uint8Array> {
  const t0 = performance.now()
  if (source.kind === 'file') {
    post({ type: 'model', source: 'file', bytes: source.buffer.byteLength, ms: 0 })
    return new Uint8Array(source.buffer)
  }
  const cache = typeof caches === 'undefined' ? null : await caches.open(MODEL_CACHE_NAME)
  const hit = await cache?.match(source.url)
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer())
    post({ type: 'model', source: 'cache', bytes: bytes.byteLength, ms: performance.now() - t0 })
    return bytes
  }
  const response = await fetch(source.url)
  if (!response.ok || !response.body) {
    throw new Error(`model download failed: HTTP ${response.status}`)
  }
  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let loaded = 0
  let lastReport = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    parts.push(value)
    loaded += value.byteLength
    if (performance.now() - lastReport > 100) {
      lastReport = performance.now()
      post({ type: 'download', loaded, total })
    }
  }
  post({ type: 'download', loaded, total: total || loaded })
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  const ms = performance.now() - t0
  await cache?.put(source.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }))
  post({ type: 'model', source: 'network', bytes: loaded, ms })
  return bytes
}

async function createSession(bytes: Uint8Array, choice: BackendChoice): Promise<{ session: ort.InferenceSession, backend: 'webgpu' | 'wasm', fallbackError?: string }> {
  // Backends are tried one at a time (rather than passing both to ORT) so we know for
  // certain which one the session ended up on.
  const order: Array<'webgpu' | 'wasm'> = choice === 'auto' ? ['webgpu', 'wasm'] : [choice]
  let fallbackError: string | undefined
  for (const backend of order) {
    try {
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: [backend],
        graphOptimizationLevel: 'all',
      })
      return { session, backend, fallbackError }
    }
    catch (error) {
      fallbackError = `${backend}: ${error instanceof Error ? error.message : String(error)}`
      if (backend === order.at(-1)) {
        throw new Error(fallbackError)
      }
    }
  }
  throw new Error('unreachable')
}

async function run(request: RunRequest): Promise<void> {
  const { params, margin } = request
  const { nFft, hop, dimF, dimT } = params
  if (dimF > nFft / 2 + 1) {
    throw new Error(`dim_f ${dimF} exceeds the ${nFft / 2 + 1} bins of n_fft ${nFft}`)
  }

  const key = request.model.kind === 'url' ? request.model.url : `file:${request.model.name}:${request.model.buffer.byteLength}`
  const wantBackend = request.backend
  let session: ort.InferenceSession
  if (cached && cached.key === key && (wantBackend === 'auto' || wantBackend === cached.backend)) {
    session = cached.session
    post({ type: 'session', backend: cached.backend, ms: 0, reused: true, numThreads: ort.env.wasm.numThreads ?? 0, inputShape: describeInput(session) })
  }
  else {
    if (cached) {
      await cached.session.release()
      cached = null
    }
    post({ type: 'status', message: '加载模型…' })
    const bytes = await loadModel(request.model)
    post({ type: 'status', message: '创建推理会话…' })
    const t0 = performance.now()
    const created = await createSession(bytes, wantBackend)
    session = created.session
    cached = { key, backend: created.backend, session }
    post({
      type: 'session',
      backend: created.backend,
      ms: performance.now() - t0,
      reused: false,
      fallbackError: created.fallbackError,
      numThreads: ort.env.wasm.numThreads ?? 0,
      inputShape: describeInput(session),
    })
  }

  const tStart = performance.now()
  const stft = new Stft(nFft, hop)
  const frames = stft.frameCount(request.left.length)
  const plan = planChunks(frames, dimT, margin)
  post({ type: 'plan', frames, frameRate: request.sampleRate / hop, chunks: plan.length })

  const plane = dimF * dimT
  const input = new Float32Array(4 * plane)
  const re = new Float32Array(dimF)
  const im = new Float32Array(dimF)
  const comp2 = params.compensate ** 2
  // The vocals are rebuilt frame by frame as each chunk comes back; both channels share one
  // summed window.
  const vocalLeft = new Istft(nFft, hop, request.left.length)
  const vocalRight = new Istft(nFft, hop, request.left.length, vocalLeft.windowSum)
  const binRe = new Float32Array(dimF)
  const binIm = new Float32Array(dimF)
  let istftTotal = 0
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]

  for (const [index, chunk] of plan.entries()) {
    if (cancelled) {
      post({ type: 'cancelled' })
      return
    }
    const keep = chunk.keepEnd - chunk.keepStart
    const mixDb = new Float32Array(keep)

    const tStft = performance.now()
    input.fill(0)
    const channels = [request.left, request.right]
    for (let t = 0; t < dimT; t++) {
      const frame = chunk.start + t
      if (frame >= frames) {
        break
      }
      let energy = 0
      for (let c = 0; c < 2; c++) {
        stft.frame(channels[c], frame, re, im, dimF)
        const reBase = 2 * c * plane + t
        const imBase = reBase + plane
        for (let f = 0; f < dimF; f++) {
          input[reBase + f * dimT] = re[f]
          input[imBase + f * dimT] = im[f]
          energy += re[f] * re[f] + im[f] * im[f]
        }
      }
      if (frame >= chunk.keepStart && frame < chunk.keepEnd) {
        mixDb[frame - chunk.keepStart] = toDb(energy)
      }
    }
    const stftMs = performance.now() - tStft

    const tInfer = performance.now()
    const tensor = new ort.Tensor('float32', input, [1, 4, dimF, dimT])
    const result = await session.run({ [inputName]: tensor })
    const output = result[outputName]
    const out = (await output.getData()) as Float32Array
    const inferMs = performance.now() - tInfer

    const vocalDb = new Float32Array(keep)
    const instrumental = params.primaryStem === 'Instrumental'
    for (let k = 0; k < keep; k++) {
      const t = chunk.keepStart - chunk.start + k
      let energy = 0
      for (let i = t; i < 4 * plane; i += dimT) {
        // Instrumental models: vocals = mix - compensate * instrumental (UVR's secondary stem).
        const v = instrumental ? input[i] - params.compensate * out[i] : out[i]
        energy += v * v
      }
      vocalDb[k] = toDb(instrumental ? energy : energy * comp2)
    }

    const tIstft = performance.now()
    for (let k = 0; k < keep; k++) {
      const t = chunk.keepStart - chunk.start + k
      for (const [c, target] of [vocalLeft, vocalRight].entries()) {
        const reBase = 2 * c * plane + t
        const imBase = reBase + plane
        for (let f = 0; f < dimF; f++) {
          const i = f * dimT
          binRe[f] = instrumental ? input[reBase + i] - params.compensate * out[reBase + i] : out[reBase + i]
          binIm[f] = instrumental ? input[imBase + i] - params.compensate * out[imBase + i] : out[imBase + i]
        }
        target.add(chunk.keepStart + k, binRe, binIm, c === 0)
      }
    }
    const istftMs = performance.now() - tIstft
    istftTotal += istftMs
    output.dispose()

    post({ type: 'chunk', index, start: chunk.keepStart, vocalDb, mixDb, stftMs, inferMs, istftMs }, [vocalDb.buffer, mixDb.buffer])
    // Let a pending cancel message land before the next chunk.
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  const tFinish = performance.now()
  const vocals: [Float32Array, Float32Array] = [vocalLeft.finish(), vocalRight.finish()]
  // The input is no longer needed, so the accompaniment is worked out in its place.
  const accompaniment: [Float32Array, Float32Array] = [request.left, request.right]
  for (const [c, mix] of accompaniment.entries()) {
    for (let i = 0; i < mix.length; i++) {
      mix[i] -= vocals[c][i]
    }
  }
  const ms = istftTotal + performance.now() - tFinish
  post({ type: 'stems', sampleRate: request.sampleRate, vocals, instrumental: accompaniment, ms }, [...vocals, ...accompaniment].map(a => a.buffer))
  post({ type: 'done', totalMs: performance.now() - tStart })
}

function describeInput(session: ort.InferenceSession): string {
  const meta = session.inputMetadata[0]
  if (meta && meta.isTensor) {
    return `${meta.name} [${meta.shape.join(', ')}]`
  }
  return session.inputNames.join(', ')
}
