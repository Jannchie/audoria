import type { LyricsDoc } from '@audoria/lyrics-core'
import type { InjectionKey, Ref, ShallowRef } from 'vue'
import type { AudioSource, LineStatus, Peaks, WordRef } from './core/index.js'
import type { EditorMessages } from './messages.js'
import { inject, reactive, ref, shallowRef } from 'vue'
import { decodePeaks, History, lineStatus, prepareForTiming, wordAt } from './core/index.js'

export type Stage = 'line' | 'word' | 'preview'

/** A stage's keyboard handler; returns true when it handled the key. */
export type KeyHandler = (event: KeyboardEvent) => boolean

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
  /** Lines switched to word timing before any of their words is timed. */
  wordLines: Set<string>
  /** A line is timed word by word once a word is timed, or once switched to it. */
  isWordMode: (cue: number) => boolean
  statusOf: (cue: number) => LineStatus
  /** The last stamp, for a brief flash where it landed. */
  lastStamp: Ref<{ cue: number, word?: number, at: number } | null>
  markStamp: (cue: number, word?: number) => void

  peaks: ShallowRef<Peaks | null>
  peaksState: Ref<'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'>
  loadPeaks: () => void

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

export function createSession(options: {
  initial: LyricsDoc
  audio: () => AudioSource
  loadAudioData?: () => Promise<ArrayBuffer>
  onChange: (doc: LyricsDoc) => void
  messages: Ref<EditorMessages>
}): EditorSession {
  const history = new History<LyricsDoc>(prepareForTiming(options.initial))
  const doc = shallowRef(history.present)
  const canUndo = ref(false)
  const canRedo = ref(false)
  const cursor = ref<WordRef>({ cue: 0, word: 0 })
  const wordLines = reactive(new Set<string>())

  function firstOpenLine(value: LyricsDoc): number {
    const index = value.cues.findIndex(cue => cue.words.length > 0 && lineStatus(cue) !== 'word' && lineStatus(cue) !== 'line')
    return Math.max(0, index === -1 ? value.cues.findIndex(cue => cue.words.length > 0) : index)
  }
  cursor.value = { cue: firstOpenLine(doc.value), word: 0 }

  function sync(): void {
    doc.value = history.present
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
    if (!wordAt(doc.value, cursor.value)) {
      const cue = Math.min(cursor.value.cue, doc.value.cues.length - 1)
      cursor.value = { cue: Math.max(0, cue), word: 0 }
    }
    options.onChange(doc.value)
  }

  const audio = options.audio
  const now = ref(0)
  const playing = ref(false)
  const duration = ref(0)
  const rate = ref(1)
  const peaks = shallowRef<Peaks | null>(null)
  const peaksState = ref<'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'>(options.loadAudioData ? 'idle' : 'unavailable')
  const lastStamp = ref<{ cue: number, word?: number, at: number } | null>(null)

  return {
    doc,
    canUndo,
    canRedo,
    apply(next, group) {
      history.record(next, group)
      sync()
    },
    undo() {
      history.undo()
      sync()
    },
    redo() {
      history.redo()
      sync()
    },
    reset(value) {
      history.reset(prepareForTiming(value))
      doc.value = history.present
      canUndo.value = false
      canRedo.value = false
      wordLines.clear()
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
    wordLines,
    isWordMode(index) {
      const cue = doc.value.cues[index]
      return Boolean(cue) && (cue.words.some(word => word.begin !== undefined) || wordLines.has(cue.id))
    },
    statusOf(index) {
      const cue = doc.value.cues[index]
      return cue ? lineStatus(cue) : 'empty'
    },
    lastStamp,
    markStamp(cue, word) {
      lastStamp.value = { cue, word, at: performance.now() }
    },

    peaks,
    peaksState,
    loadPeaks() {
      if (!options.loadAudioData || peaksState.value === 'loading' || peaksState.value === 'ready') {
        return
      }
      peaksState.value = 'loading'
      options.loadAudioData()
        .then(data => decodePeaks(data))
        .then((value) => {
          peaks.value = value
          peaksState.value = 'ready'
        })
        .catch(() => {
          peaksState.value = 'failed'
        })
    },

    keyHandler: shallowRef<KeyHandler | null>(null),
    t: options.messages,
  }
}
