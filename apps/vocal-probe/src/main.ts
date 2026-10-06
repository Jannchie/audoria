import type { MdxParams, PrimaryStem } from './models'
import type { BackendChoice, FromWorker, ModelSource, RunRequest } from './protocol'
import { MODEL_CACHE_NAME, MODEL_PRESETS } from './models'
import { Viz } from './viz'
import './style.css'

const SAMPLE_RATE = 44_100
const LOCAL_MODEL = 'local'

function $<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!
}

const audioInput = $<HTMLInputElement>('audio-file')
const modelSelect = $<HTMLSelectElement>('model-select')
const localModelField = $<HTMLLabelElement>('local-model-field')
const modelFileInput = $<HTMLInputElement>('model-file')
const backendSelect = $<HTMLSelectElement>('backend-select')
const runBtn = $<HTMLButtonElement>('run-btn')
const cancelBtn = $<HTMLButtonElement>('cancel-btn')
const clearCacheBtn = $<HTMLButtonElement>('clear-cache-btn')
const downloadBtn = $<HTMLButtonElement>('download-btn')
const progressFill = $<HTMLDivElement>('progress-fill')
const statusEl = $<HTMLDivElement>('status')
const metricsEl = $<HTMLTableSectionElement>('metrics')
const player = $<HTMLAudioElement>('player')
const paramInputs = {
  nFft: $<HTMLInputElement>('p-nfft'),
  hop: $<HTMLInputElement>('p-hop'),
  dimF: $<HTMLInputElement>('p-dimf'),
  dimT: $<HTMLInputElement>('p-dimt'),
  compensate: $<HTMLInputElement>('p-comp'),
}
const marginInput = $<HTMLInputElement>('p-margin')
const stemSelect = $<HTMLSelectElement>('p-stem')
const stemButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-stem]')]
const stemLinks = { vocals: $<HTMLAnchorElement>('dl-vocals'), instrumental: $<HTMLAnchorElement>('dl-instrumental') }

const viz = new Viz($<HTMLCanvasElement>('viz'), player)

let audio: { buffer: AudioBuffer, name: string, decodeMs: number } | null = null
let envelopes: { frameRate: number, vocalDb: Float32Array, mixDb: Float32Array } | null = null
let running = false
let run: { t0: number, chunks: number, inferMs: number[], stftMs: number[], istftMs: number[] } | null = null
const metrics = new Map<string, string>()

// ---- metrics ---------------------------------------------------------------

function setMetric(label: string, value: string): void {
  metrics.set(label, value)
  renderMetrics()
}

function renderMetrics(): void {
  metricsEl.replaceChildren(...[...metrics].map(([label, value]) => {
    const row = document.createElement('tr')
    const th = document.createElement('th')
    th.textContent = label
    const td = document.createElement('td')
    td.textContent = value
    row.append(th, td)
    return row
  }))
}

const ms = (v: number): string => `${v.toFixed(0)} ms`
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

function roundDb(values: Float32Array): number[] {
  return Array.from(values, v => Math.round(v * 100) / 100)
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? Number.NaN
}

function recordMemory(): void {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number, totalJSHeapSize: number, jsHeapSizeLimit: number } }).memory
  setMetric('performance.memory（主线程）', memory
    ? `used ${mb(memory.usedJSHeapSize)} / total ${mb(memory.totalJSHeapSize)} / limit ${mb(memory.jsHeapSizeLimit)}`
    : '不可用')
}

interface GpuAdapterLike {
  info?: { vendor?: string, architecture?: string, device?: string, description?: string }
  features: Set<string>
  limits: { maxBufferSize: number, maxStorageBufferBindingSize: number }
}

async function recordGpu(): Promise<void> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<GpuAdapterLike | null> } }).gpu
  if (!gpu) {
    setMetric('WebGPU 适配器', 'navigator.gpu 不可用')
    return
  }
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) {
      setMetric('WebGPU 适配器', 'requestAdapter() 返回 null')
      return
    }
    const info = adapter.info ?? {}
    const parts = [info.vendor, info.architecture, info.device, info.description].filter(Boolean)
    setMetric('WebGPU 适配器', parts.join(' / ') || '（无信息）')
    setMetric('WebGPU 特性', `shader-f16: ${adapter.features.has('shader-f16') ? '是' : '否'}; maxBufferSize ${mb(adapter.limits.maxBufferSize)}; maxStorageBinding ${mb(adapter.limits.maxStorageBufferBindingSize)}`)
  }
  catch (error) {
    setMetric('WebGPU 适配器', `出错：${String(error)}`)
  }
}

// ---- separated audio -------------------------------------------------------

type StemName = 'mix' | 'vocals' | 'instrumental'
// Object URLs of what the player can switch between; the mix is the original file.
const stemUrls = new Map<StemName, string>()

/** 16-bit PCM WAV, so the stems play in an <audio> element and can be saved. */
function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const frames = channels[0].length
  const bytes = 44 + frames * channels.length * 2
  const view = new DataView(new ArrayBuffer(bytes))
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(at + i, value.charCodeAt(i))
    }
  }
  text(0, 'RIFF')
  view.setUint32(4, bytes - 8, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels.length, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels.length * 2, true)
  view.setUint16(32, channels.length * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, frames * channels.length * 2, true)
  let at = 44
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      view.setInt16(at, Math.max(-1, Math.min(1, channel[i])) * 0x7F_FF, true)
      at += 2
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' })
}

function clearStems(): void {
  for (const [name, url] of stemUrls) {
    if (name !== 'mix') {
      URL.revokeObjectURL(url)
      stemUrls.delete(name)
    }
  }
  for (const button of stemButtons) {
    button.disabled = button.dataset.stem !== 'mix'
  }
  stemLinks.vocals.hidden = true
  stemLinks.instrumental.hidden = true
  viz.setVocals(null)
  showStem('mix')
}

/** Switches what the player plays, keeping its place and whether it was playing. */
function showStem(name: StemName): void {
  const url = stemUrls.get(name)
  if (!url) {
    return
  }
  for (const button of stemButtons) {
    button.classList.toggle('vp-seg-btn--on', button.dataset.stem === name)
  }
  if (player.src === url) {
    return
  }
  const at = player.currentTime
  const playing = !player.paused
  player.src = url
  player.addEventListener('loadedmetadata', () => {
    player.currentTime = at
    if (playing) {
      void player.play()
    }
  }, { once: true })
}

for (const button of stemButtons) {
  button.addEventListener('click', () => showStem(button.dataset.stem as StemName))
}

// ---- worker ----------------------------------------------------------------

const worker = new Worker(new URL('worker.ts', import.meta.url), { type: 'module' })
worker.addEventListener('message', (event: MessageEvent<FromWorker>) => onWorkerMessage(event.data))
worker.addEventListener('error', (event) => {
  setStatus(`Worker 错误：${event.message}`)
  finishRun()
})

function setStatus(text: string): void {
  statusEl.textContent = text
}

function setProgress(fraction: number): void {
  progressFill.style.width = `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(1)}%`
}

function onWorkerMessage(message: FromWorker): void {
  switch (message.type) {
    case 'ready': {
      $<HTMLSpanElement>('ort-version').textContent = `ort ${message.ortVersion}`
      setMetric('跨源隔离 / wasm 线程', `crossOriginIsolated=${message.crossOriginIsolated}, numThreads=${message.numThreads}`)
      break
    }
    case 'status': {
      setStatus(message.message)
      break
    }
    case 'download': {
      setProgress(message.total ? message.loaded / message.total : 0)
      setStatus(`下载模型 ${mb(message.loaded)}${message.total ? ` / ${mb(message.total)}` : ''}`)
      break
    }
    case 'model': {
      setMetric('模型获取', `${{ network: '网络下载', cache: 'Cache API 命中', file: '本地文件' }[message.source]} · ${mb(message.bytes)} · ${ms(message.ms)}`)
      break
    }
    case 'session': {
      setMetric('实际后端', message.backend + (message.fallbackError ? `（回退原因：${message.fallbackError}）` : ''))
      setMetric('会话创建', message.reused ? '复用已有会话' : ms(message.ms))
      setMetric('模型输入', message.inputShape)
      setMetric('wasm 线程数', String(message.numThreads))
      break
    }
    case 'plan': {
      const fill = (): Float32Array => new Float32Array(message.frames).fill(-Infinity)
      envelopes = { frameRate: message.frameRate, vocalDb: fill(), mixDb: fill() }
      viz.setEnvelopes(envelopes)
      run = { t0: performance.now(), chunks: message.chunks, inferMs: [], stftMs: [], istftMs: [] }
      setMetric('帧数 / 帧率', `${message.frames} 帧 · ${message.frameRate.toFixed(2)} fps`)
      setMetric('分块数', String(message.chunks))
      setProgress(0)
      break
    }
    case 'chunk': {
      if (!envelopes || !run) {
        break
      }
      envelopes.vocalDb.set(message.vocalDb, message.start)
      envelopes.mixDb.set(message.mixDb, message.start)
      run.inferMs.push(message.inferMs)
      run.stftMs.push(message.stftMs)
      run.istftMs.push(message.istftMs)
      viz.envelopesChanged()
      setProgress((message.index + 1) / run.chunks)
      setStatus(`分离中 ${message.index + 1} / ${run.chunks} · 本块推理 ${ms(message.inferMs)} · STFT ${ms(message.stftMs)} · iSTFT ${ms(message.istftMs)}`)
      break
    }
    case 'stems': {
      viz.setVocals(message.vocals)
      const t0 = performance.now()
      const base = audio?.name.replace(/\.[^.]+$/, '') ?? 'stem'
      for (const [name, channels] of [['vocals', message.vocals], ['instrumental', message.instrumental]] as const) {
        const url = URL.createObjectURL(encodeWav(channels, message.sampleRate))
        stemUrls.set(name, url)
        stemLinks[name].href = url
        stemLinks[name].download = `${base}.${name}.wav`
        stemLinks[name].hidden = false
      }
      for (const button of stemButtons) {
        button.disabled = false
      }
      setMetric('还原音频（iSTFT + 伴奏）', ms(message.ms))
      setMetric('WAV 编码', ms(performance.now() - t0))
      break
    }
    case 'done': {
      if (!run || !audio) {
        break
      }
      const seconds = message.totalMs / 1000
      const duration = audio.buffer.duration
      const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0)
      setMetric('分离总耗时', `${ms(message.totalMs)}（推理 ${ms(sum(run.inferMs))} · STFT+打包 ${ms(sum(run.stftMs))} · iSTFT ${ms(sum(run.istftMs))}）`)
      setMetric('实时率 RTF', `${(seconds / duration).toFixed(3)}（${(duration / seconds).toFixed(1)}× 实时）`)
      setMetric('单块推理 mean / p95', `${ms(sum(run.inferMs) / run.inferMs.length)} / ${ms(percentile(run.inferMs, 0.95))}（首块 ${ms(run.inferMs[0])}）`)
      setMetric('单块 STFT mean', ms(sum(run.stftMs) / run.stftMs.length))
      recordMemory()
      setStatus(`完成：${duration.toFixed(1)} s 音频用时 ${seconds.toFixed(1)} s。`)
      downloadBtn.disabled = false
      finishRun()
      break
    }
    case 'cancelled': {
      setStatus('已取消。')
      finishRun()
      break
    }
    case 'error': {
      setStatus(`出错：${message.message}`)
      finishRun()
      break
    }
  }
}

function finishRun(): void {
  running = false
  updateButtons()
}

function updateButtons(): void {
  const needsLocal = modelSelect.value === LOCAL_MODEL && !modelFileInput.files?.length
  runBtn.disabled = running || !audio || needsLocal
  cancelBtn.disabled = !running
  audioInput.disabled = running
}

// ---- inputs ----------------------------------------------------------------

for (const preset of MODEL_PRESETS) {
  modelSelect.add(new Option(`${preset.label}（${mb(preset.bytes)}）`, preset.id))
}
modelSelect.add(new Option('本地 .onnx 文件…', LOCAL_MODEL))

function applyPreset(): void {
  const preset = MODEL_PRESETS.find(p => p.id === modelSelect.value)
  localModelField.hidden = modelSelect.value !== LOCAL_MODEL
  if (preset) {
    paramInputs.nFft.value = String(preset.params.nFft)
    paramInputs.hop.value = String(preset.params.hop)
    paramInputs.dimF.value = String(preset.params.dimF)
    paramInputs.dimT.value = String(preset.params.dimT)
    paramInputs.compensate.value = String(preset.params.compensate)
    stemSelect.value = preset.params.primaryStem
  }
  updateButtons()
}
modelSelect.addEventListener('change', applyPreset)
modelFileInput.addEventListener('change', updateButtons)
applyPreset()

function readParams(): MdxParams {
  return {
    nFft: Number(paramInputs.nFft.value),
    hop: Number(paramInputs.hop.value),
    dimF: Number(paramInputs.dimF.value),
    dimT: Number(paramInputs.dimT.value),
    compensate: Number(paramInputs.compensate.value),
    primaryStem: stemSelect.value as PrimaryStem,
  }
}

audioInput.addEventListener('change', async () => {
  const file = audioInput.files?.[0]
  if (!file) {
    return
  }
  setStatus('解码音频…')
  try {
    const t0 = performance.now()
    // decodeAudioData resamples to the context rate; the length-1 context is never rendered.
    const buffer = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(await file.arrayBuffer())
    audio = { buffer, name: file.name, decodeMs: performance.now() - t0 }
    const previous = stemUrls.get('mix')
    if (previous) {
      URL.revokeObjectURL(previous)
    }
    stemUrls.set('mix', URL.createObjectURL(file))
    clearStems()
    player.load()
    viz.setAudio(buffer)
    envelopes = null
    downloadBtn.disabled = true
    setMetric('音频', `${file.name} · ${buffer.duration.toFixed(2)} s · ${buffer.numberOfChannels} ch → 44.1 kHz 立体声`)
    setMetric('解码耗时', ms(audio.decodeMs))
    setStatus('已加载，点击「运行」。')
  }
  catch (error) {
    setStatus(`解码失败：${String(error)}`)
  }
  updateButtons()
})

runBtn.addEventListener('click', async () => {
  if (!audio || running) {
    return
  }
  const params = readParams()
  let model: ModelSource
  const preset = MODEL_PRESETS.find(p => p.id === modelSelect.value)
  if (preset) {
    model = { kind: 'url', url: preset.url }
  }
  else {
    const file = modelFileInput.files?.[0]
    if (!file) {
      return
    }
    model = { kind: 'file', name: file.name, buffer: await file.arrayBuffer() }
  }
  const { buffer } = audio
  // Copies, so the AudioBuffer (still used for the waveform) keeps its data.
  const left = new Float32Array(buffer.getChannelData(0))
  const right = new Float32Array(buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0))
  for (const key of ['分离总耗时', '实时率 RTF', '单块推理 mean / p95', '单块 STFT mean', '会话创建', '模型获取', '还原音频（iSTFT + 伴奏）', 'WAV 编码']) {
    metrics.delete(key)
  }
  const modelName = model.kind === 'file' ? model.name : preset?.label
  setMetric('模型', `${modelName} · n_fft ${params.nFft} · hop ${params.hop} · dim_f ${params.dimF} · dim_t ${params.dimT} · ×${params.compensate} · ${params.primaryStem}`)
  setMetric('请求后端', backendSelect.value)
  running = true
  downloadBtn.disabled = true
  clearStems()
  updateButtons()
  setProgress(0)
  const request: RunRequest = {
    type: 'run',
    left,
    right,
    sampleRate: buffer.sampleRate,
    model,
    params,
    backend: backendSelect.value as BackendChoice,
    margin: Number(marginInput.value) || 0,
  }
  worker.postMessage(request, [left.buffer, right.buffer])
})

cancelBtn.addEventListener('click', () => worker.postMessage({ type: 'cancel' }))

clearCacheBtn.addEventListener('click', async () => {
  const removed = typeof caches !== 'undefined' && await caches.delete(MODEL_CACHE_NAME)
  setStatus(removed ? '已清除模型缓存（已创建的会话仍在内存中复用，刷新页面可彻底重测）。' : '没有模型缓存。')
})

downloadBtn.addEventListener('click', () => {
  if (!envelopes) {
    return
  }
  const json = JSON.stringify({ frameRate: envelopes.frameRate, vocalDb: roundDb(envelopes.vocalDb), mixDb: roundDb(envelopes.mixDb) })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  link.download = `${audio?.name.replace(/\.[^.]+$/, '') ?? 'envelope'}.envelope.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
})

recordMemory()
void recordGpu()
renderMetrics()
