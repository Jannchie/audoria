import type { LyricsCue, LyricsDoc } from '@audoria/lyrics-core'
import type { InjectionKey, Ref, ShallowRef } from 'vue'
import type { AudioSource, Peaks, WordRef } from './core/index.js'
import type { EditorMessages } from './messages.js'
import { inject, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { decodePeaks, firstOpenLine, History, nextLine, prepareForTiming, shiftLine, stampLine, wordAt } from './core/index.js'

export type Stage = 'line' | 'word' | 'preview'

/** A stage's keyboard handler; returns true when it handled the key. */
export type KeyHandler = (event: KeyboardEvent) => boolean

/** Where the last mark landed: the line, the word for word marks, and the playback time. */
export interface Stamp {
  cue: number
  word?: number
  ms: number
  /** Wall-clock time, so the same mark made twice still flashes twice. */
  at: number
}

export type PeaksState = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'

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
  /** A line is timed word by word once a word is timed, or once switched to it. */
  isWordMode: (cue: number) => boolean
  /** Switches a line to word timing before any of its words is timed, or back. */
  setWordMode: (cue: number, on: boolean) => void

  /** Marks the start of a whole line now, and moves on to the next line with words that `accept` takes. */
  stampLineNow: (cue: number, accept?: (line: LyricsCue) => boolean) => void
  /** Moves a whole line, grouped so a run of nudges undoes in one step. */
  nudgeLine: (cue: number, deltaMs: number) => void
  lastStamp: Ref<Stamp | null>
  markStamp: (cue: number, word?: number, ms?: number) => void
  isFlashing: (cue: number, word?: number) => boolean

  peaks: ShallowRef<Peaks | null>
  peaksState: Ref<PeaksState>
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
  onChange: (doc: LyricsDoc) => void
  messages: Ref<EditorMessages>
}): EditorSession {
  const audio = options.audio
  const history = new History<LyricsDoc>(prepareForTiming(options.initial))
  const doc = shallowRef(history.present)
  const canUndo = ref(false)
  const canRedo = ref(false)
  const cursor = ref<WordRef>({ cue: firstOpenLine(doc.value), word: 0 })
  // Lines switched to word timing before any word is timed: an editing intent, not document data.
  const wordLines = reactive(new Set<string>())
  const now = ref(0)
  const playing = ref(false)
  const duration = ref(0)
  const rate = ref(1)
  const peaks = shallowRef<Peaks | null>(null)
  const peaksState = ref<PeaksState>(options.loadAudioData ? 'idle' : 'unavailable')
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

  function markStamp(cue: number, word?: number, ms = audio().currentTime * 1000): void {
    lastStamp.value = { cue, word, ms, at: performance.now() }
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
    selectLine(cue) {
      cursor.value = { cue, word: 0 }
    },
    isWordMode(index) {
      const cue = doc.value.cues[index]
      return Boolean(cue) && (cue.words.some(word => word.begin !== undefined) || wordLines.has(cue.id))
    },
    setWordMode(index, on) {
      const id = doc.value.cues[index]?.id
      if (id !== undefined) {
        if (on) {
          wordLines.add(id)
        }
        else {
          wordLines.delete(id)
        }
      }
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
