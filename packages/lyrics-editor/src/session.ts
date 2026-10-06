import type { LyricsCue, LyricsDoc } from '@audoria/lyrics-core'
import type { InjectionKey, Ref, ShallowRef } from 'vue'
import type { AudioSource, Peaks, WordRef } from './core/index.js'
import type { EditorMessages } from './messages.js'
import type { VocalAnalysis } from './vocals/analysis.js'
import type { SeparationProgress } from './vocals/separate.js'
import { inject, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { decodePeaks, firstOpenLine, History, nextLine, prepareForTiming, shiftLine, stampLine, wordAt } from './core/index.js'
import { decodeVocalAnalysis, encodeVocalAnalysis } from './vocals/analysis.js'

export type Stage = 'line' | 'word' | 'preview'

/** A stage's keyboard handler; returns true when it handled the key. */
export type KeyHandler = (event: KeyboardEvent) => boolean

/** Where the last mark landed: the line, the word for word marks, and the playback time. */
export interface Stamp {
  cue: number
  word?: number
  ms: number
  /** Where a word mark left the cursor; the mark stays the one to end while the cursor is still there. */
  after?: WordRef
  /** Wall-clock time, so the same mark made twice still flashes twice. */
  at: number
}

export type PeaksState = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'

/**
 * Where separated vocals are kept between sessions, so a song is separated once. The host
 * decides where; the analysis is opaque bytes to it.
 */
export interface VocalsStore {
  /** The stored analysis, or null when the song hasn't been separated yet. */
  load: () => Promise<ArrayBuffer | null>
  save: (data: ArrayBuffer) => Promise<void>
}

export type VocalsState = 'unavailable' | 'idle' | 'loading' | 'separating' | 'ready' | 'failed'

/**
 * State the editor's stages share: the document with its history, playback, the selected line
 * and word, and which lines are being timed word by word.
 */
export interface EditorSession {
  doc: ShallowRef<LyricsDoc>
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  apply: (next: LyricsDoc, group?: string) => void
  undo: () => void
  redo: () => void
  reset: (doc: LyricsDoc) => void

  /** Playback position in ms, updated every frame; for display. */
  now: Ref<number>
  /** The position this instant, for marks: a frame-old position would be up to a frame late. */
  currentMs: () => number
  isPlaying: () => boolean
  playing: Ref<boolean>
  duration: Ref<number>
  rate: Ref<number>
  togglePlay: () => void
  play: () => void
  seek: (ms: number) => void
  setRate: (rate: number) => void

  stage: Ref<Stage>
  cursor: Ref<WordRef>
  selectLine: (cue: number) => void

  /** Marks the start of a whole line now, and moves on to the next line with words that `accept` takes. */
  stampLineNow: (cue: number, accept?: (line: LyricsCue) => boolean) => void
  /** Moves a whole line, grouped so a run of nudges undoes in one step. */
  nudgeLine: (cue: number, deltaMs: number) => void
  lastStamp: Ref<Stamp | null>
  markStamp: (cue: number, word?: number, ms?: number, after?: WordRef) => void
  isFlashing: (cue: number, word?: number) => boolean

  peaks: ShallowRef<Peaks | null>
  peaksState: Ref<PeaksState>
  loadPeaks: () => void

  vocals: ShallowRef<VocalAnalysis | null>
  vocalsState: Ref<VocalsState>
  vocalsProgress: Ref<SeparationProgress | null>
  vocalsError: Ref<string>
  /** Whether the vocals are drawn over the song's waveform. */
  showVocals: Ref<boolean>
  /** Picks up vocals separated before, if the host keeps them. */
  loadVocals: () => void
  /** Separates the vocals now (a fresh run replaces any kept ones) and keeps them with the host. */
  separateVocals: () => void

  keyHandler: ShallowRef<KeyHandler | null>
  t: Ref<EditorMessages>
}

export const SESSION_KEY: InjectionKey<EditorSession> = Symbol('lyrics-editor-session')

export function useSession(): EditorSession {
  const session = inject(SESSION_KEY)
  if (!session) {
    throw new Error('Lyrics editor stages must be used inside LyricsTimingEditor')
  }
  return session
}

/** Routes keys to a stage while it is shown; the shell asks the stage first. */
export function useStageKeys(session: EditorSession, handler: KeyHandler): void {
  onMounted(() => {
    session.keyHandler.value = handler
  })
  onBeforeUnmount(() => {
    if (session.keyHandler.value === handler) {
      session.keyHandler.value = null
    }
  })
}

export function createSession(options: {
  initial: LyricsDoc
  audio: () => AudioSource
  loadAudioData?: () => Promise<ArrayBuffer>
  vocalsStore?: VocalsStore
  onChange: (doc: LyricsDoc) => void
  messages: Ref<EditorMessages>
}): EditorSession {
  const audio = options.audio
  const history = new History<LyricsDoc>(prepareForTiming(options.initial))
  const doc = shallowRef(history.present)
  const canUndo = ref(false)
  const canRedo = ref(false)
  const cursor = ref<WordRef>({ cue: firstOpenLine(doc.value), word: 0 })
  const now = ref(0)
  const playing = ref(false)
  const duration = ref(0)
  const rate = ref(1)
  const peaks = shallowRef<Peaks | null>(null)
  const peaksState = ref<PeaksState>(options.loadAudioData ? 'idle' : 'unavailable')
  const vocals = shallowRef<VocalAnalysis | null>(null)
  const vocalsState = ref<VocalsState>(options.loadAudioData ? 'idle' : 'unavailable')
  const vocalsProgress = ref<SeparationProgress | null>(null)
  const vocalsError = ref('')
  const showVocals = ref(true)

  // The song is fetched once for both the waveform and the separation. Decoding takes over
  // (detaches) the buffer it is given, so each gets a copy.
  let audioData: Promise<ArrayBuffer> | null = null
  function songData(): Promise<ArrayBuffer> {
    audioData ??= options.loadAudioData!()
    audioData.catch(() => {
      audioData = null
    })
    // An ArrayBuffer copy; spreading would make an array of numbers.
    // eslint-disable-next-line unicorn/prefer-spread
    return audioData.then(data => data.slice(0))
  }
  const lastStamp = ref<Stamp | null>(null)

  function refresh(): void {
    doc.value = history.present
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
    if (!wordAt(doc.value, cursor.value)) {
      cursor.value = { cue: Math.max(0, Math.min(cursor.value.cue, doc.value.cues.length - 1)), word: 0 }
    }
  }

  function apply(next: LyricsDoc, group?: string): void {
    history.record(next, group)
    refresh()
    options.onChange(doc.value)
  }

  function markStamp(cue: number, word?: number, ms = audio().currentTime * 1000, after?: WordRef): void {
    lastStamp.value = { cue, word, ms, after, at: performance.now() }
  }

  return {
    doc,
    canUndo,
    canRedo,
    apply,
    undo() {
      history.undo()
      refresh()
      options.onChange(doc.value)
    },
    redo() {
      history.redo()
      refresh()
      options.onChange(doc.value)
    },
    reset(value) {
      history.reset(prepareForTiming(value))
      refresh()
      cursor.value = { cue: firstOpenLine(doc.value), word: 0 }
    },

    now,
    currentMs: () => audio().currentTime * 1000,
    isPlaying: () => !audio().paused,
    playing,
    duration,
    rate,
    togglePlay() {
      if (audio().paused) {
        void audio().play()
      }
      else {
        audio().pause()
      }
    },
    play() {
      void audio().play()
    },
    seek(ms) {
      audio().seek(Math.max(0, ms) / 1000)
      now.value = Math.max(0, ms)
    },
    setRate(value) {
      audio().setPlaybackRate(value)
      rate.value = value
    },

    stage: ref<Stage>('line'),
    cursor,
    selectLine(cue) {
      cursor.value = { cue, word: 0 }
    },

    stampLineNow(index, accept) {
      const ms = audio().currentTime * 1000
      apply(stampLine(doc.value, index, ms))
      markStamp(index, undefined, ms)
      const next = nextLine(doc.value, index, 1, accept)
      if (next !== null) {
        cursor.value = { cue: next, word: 0 }
      }
    },
    nudgeLine(index, deltaMs) {
      if (doc.value.cues[index]?.begin !== undefined) {
        apply(shiftLine(doc.value, index, deltaMs), `nudge-line:${index}`)
      }
    },
    lastStamp,
    markStamp,
    isFlashing(cue, word) {
      return lastStamp.value?.cue === cue && lastStamp.value.word === word
    },

    peaks,
    peaksState,
    loadPeaks() {
      if (!options.loadAudioData || peaksState.value === 'loading' || peaksState.value === 'ready') {
        return
      }
      peaksState.value = 'loading'
      songData()
        .then(data => decodePeaks(data))
        .then((value) => {
          peaks.value = value
          peaksState.value = 'ready'
        })
        .catch(() => {
          peaksState.value = 'failed'
        })
    },

    vocals,
    vocalsState,
    vocalsProgress,
    vocalsError,
    showVocals,
    loadVocals() {
      const store = options.vocalsStore
      if (!store || vocalsState.value !== 'idle' || vocals.value) {
        return
      }
      vocalsState.value = 'loading'
      store.load()
        .then((data) => {
          vocals.value = data ? decodeVocalAnalysis(data) : null
          vocalsState.value = vocals.value ? 'ready' : 'idle'
        })
        .catch(() => {
          vocalsState.value = 'idle'
        })
    },
    separateVocals() {
      if (!options.loadAudioData || vocalsState.value === 'separating' || vocalsState.value === 'loading') {
        return
      }
      vocalsState.value = 'separating'
      vocalsError.value = ''
      vocalsProgress.value = { phase: 'separating', fraction: 0 }
      // Loaded on demand: the separation code and ONNX Runtime stay out of the editor's bundle.
      Promise.all([songData(), import('./vocals/separate.js')])
        .then(([data, module]) => module.separateVocals(data, { onProgress: (progress) => {
          vocalsProgress.value = progress
        } }))
        .then((analysis) => {
          vocals.value = analysis
          vocalsState.value = 'ready'
          showVocals.value = true
          void options.vocalsStore?.save(encodeVocalAnalysis(analysis)).catch(() => {})
        })
        .catch((error: unknown) => {
          vocalsError.value = error instanceof Error ? error.message : String(error)
          vocalsState.value = vocals.value ? 'ready' : 'failed'
        })
        .finally(() => {
          vocalsProgress.value = null
        })
    },

    keyHandler: shallowRef<KeyHandler | null>(null),
    t: options.messages,
  }
}
