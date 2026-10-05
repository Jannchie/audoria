<script setup lang="ts">
import type { LyricsDoc } from '@audoria/lyrics-core'
import type { AudioSource, WordRef } from './core/index.js'
import type { EditorLocale } from './messages.js'
import { cueText } from '@audoria/lyrics-core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { clearTiming, History, mergeWithNext, nextWord, nudgeWord, previousWord, setCueText, splitWord, stampWordEnd, stampWordStart, toWordTiming, wordAt } from './core/index.js'
import { editorMessages } from './messages.js'
import { formatTimecode, parseTimecode } from './time.js'

const props = withDefaults(defineProps<{
  /** The document being timed; it is switched to word timing as soon as it is edited. */
  doc: LyricsDoc
  audio: AudioSource
  locale?: EditorLocale
}>(), { locale: 'zh' })

const emit = defineEmits<{
  /** Every edit, as a draft: words may still lack times. Pass it through `finishTiming` to save. */
  'update:doc': [doc: LyricsDoc]
}>()

const t = computed(() => editorMessages(props.locale))
const RATES = [0.5, 0.75, 1, 1.25]

// ── Document and history ──

const history = new History<LyricsDoc>(toWordTiming(props.doc))
const doc = shallowRef(history.present)
const canUndo = ref(false)
const canRedo = ref(false)
const cursor = ref<WordRef>(firstUntimed(doc.value))

function firstUntimed(value: LyricsDoc): WordRef {
  for (const [cue, line] of value.cues.entries()) {
    const word = line.words.findIndex(item => item.begin === undefined)
    if (word !== -1) {
      return { cue, word }
    }
  }
  const cue = value.cues.findIndex(line => line.words.length > 0)
  return { cue: Math.max(0, cue), word: 0 }
}

function sync(): void {
  doc.value = history.present
  canUndo.value = history.canUndo
  canRedo.value = history.canRedo
  if (!wordAt(doc.value, cursor.value)) {
    cursor.value = firstUntimed(doc.value)
  }
  emit('update:doc', doc.value)
}

function apply(next: LyricsDoc, group?: string): void {
  history.record(next, group)
  sync()
}

function undo(): void {
  history.undo()
  sync()
}

function redo(): void {
  history.redo()
  sync()
}

// A different document from outside (another song, say) starts a fresh history; our own
// emitted drafts coming back through v-model are ignored.
watch(() => props.doc, (incoming) => {
  if (incoming === doc.value) {
    return
  }
  history.reset(toWordTiming(incoming))
  doc.value = history.present
  canUndo.value = false
  canRedo.value = false
  cursor.value = firstUntimed(doc.value)
})

const totalWords = computed(() => doc.value.cues.reduce((count, cue) => count + cue.words.length, 0))
const timedWords = computed(() => doc.value.cues.reduce((count, cue) => count + cue.words.filter(word => word.begin !== undefined).length, 0))
const selectedCue = computed(() => doc.value.cues[cursor.value.cue])
const selectedWord = computed(() => wordAt(doc.value, cursor.value))

// ── Lane: the selected line's words on a time axis ──

const laneWindow = computed(() => {
  const cue = selectedCue.value
  const times = (cue?.words ?? []).flatMap(word => [word.begin, word.end]).filter((time): time is number => time !== undefined)
  const anchor = times.length > 0 ? Math.min(...times) : cue?.begin ?? 0
  const last = times.length > 0 ? Math.max(...times) : anchor
  const start = Math.max(0, anchor - 800)
  const span = Math.max(5000, last - start + 1600)
  return { start, span }
})

// ── Playback ──

const isPlaying = ref(!props.audio.paused)
const rate = ref(props.audio.playbackRate || 1)
const duration = ref(props.audio.duration)
const activeCue = ref(-1)
const timecodeEl = ref<HTMLElement | null>(null)
const playheadEl = ref<HTMLElement | null>(null)
const linesEl = ref<HTMLElement | null>(null)

function nowMs(): number {
  return props.audio.currentTime * 1000
}

function togglePlay(): void {
  if (props.audio.paused) {
    void props.audio.play()
  }
  else {
    props.audio.pause()
  }
}

function setRate(value: number): void {
  props.audio.setPlaybackRate(value)
  rate.value = value
}

function stepRate(direction: -1 | 1): void {
  const index = RATES.indexOf(rate.value)
  const next = RATES[Math.min(RATES.length - 1, Math.max(0, (index === -1 ? RATES.indexOf(1) : index) + direction))]
  setRate(next)
}

function seek(ms: number): void {
  props.audio.seek(Math.max(0, ms) / 1000)
}

function replayFromCursor(): void {
  const begin = selectedWord.value?.begin ?? selectedCue.value?.begin
  if (begin !== undefined) {
    seek(begin - 1000)
  }
  void props.audio.play()
}

// The playhead moves every frame; it is written straight to the DOM rather than through Vue.
let frame = 0
function tick(): void {
  const time = nowMs()
  if (timecodeEl.value) {
    timecodeEl.value.textContent = formatTimecode(time)
  }
  isPlaying.value = !props.audio.paused
  duration.value = props.audio.duration

  let current = -1
  for (const [index, cue] of doc.value.cues.entries()) {
    if (cue.begin !== undefined && cue.begin <= time) {
      current = index
    }
  }
  activeCue.value = current

  const { start, span } = laneWindow.value
  if (playheadEl.value) {
    const position = (time - start) / span
    playheadEl.value.style.left = `${position * 100}%`
    playheadEl.value.style.opacity = position >= 0 && position <= 1 ? '1' : '0'
  }
  for (const element of linesEl.value?.querySelectorAll<HTMLElement>('.lte-line--active [data-begin]') ?? []) {
    const begin = Number(element.dataset.begin)
    const end = element.dataset.end ? Number(element.dataset.end) : begin + 400
    const progress = Math.min(1, Math.max(0, (time - begin) / Math.max(1, end - begin)))
    element.style.setProperty('--p', progress.toFixed(3))
  }
  frame = requestAnimationFrame(tick)
}

// ── Timing commands ──

function stamp(): void {
  if (!wordAt(doc.value, cursor.value)) {
    return
  }
  const result = stampWordStart(doc.value, cursor.value, nowMs())
  apply(result.doc)
  if (result.next) {
    cursor.value = result.next
  }
}

function stampEnd(): void {
  // The word just stamped sits before the cursor; at a line's start, that is the last word of the line before.
  const target = previousWord(doc.value, cursor.value) ?? cursor.value
  apply(stampWordEnd(doc.value, target, nowMs()))
}

function nudge(edge: 'begin' | 'end', deltaMs: number): void {
  const ref = cursor.value
  apply(nudgeWord(doc.value, ref, edge, deltaMs), `nudge:${ref.cue}:${ref.word}:${edge}`)
}

function setEdge(edge: 'begin' | 'end', text: string): void {
  const word = selectedWord.value
  const time = parseTimecode(text)
  if (!word || time === undefined) {
    return
  }
  const current = word[edge]
  apply(current === undefined
    ? (edge === 'begin' ? stampWordStart(doc.value, cursor.value, time).doc : stampWordEnd(doc.value, cursor.value, time))
    : nudgeWord(doc.value, cursor.value, edge, time - current))
}

function split(offset: number): void {
  apply(splitWord(doc.value, cursor.value, offset))
}

function merge(): void {
  apply(mergeWithNext(doc.value, cursor.value))
}

function clear(): void {
  apply(clearTiming(doc.value, cursor.value))
}

function editLineText(text: string): void {
  if (selectedCue.value && text !== cueText(selectedCue.value)) {
    apply(setCueText(doc.value, cursor.value.cue, text))
    cursor.value = { cue: cursor.value.cue, word: 0 }
  }
}

function select(ref: WordRef): void {
  cursor.value = ref
}

function moveLine(direction: -1 | 1): void {
  for (let cue = cursor.value.cue + direction; cue >= 0 && cue < doc.value.cues.length; cue += direction) {
    const count = doc.value.cues[cue].words.length
    if (count > 0) {
      cursor.value = { cue, word: Math.min(cursor.value.word, count - 1) }
      return
    }
  }
}

watch(cursor, async () => {
  await nextTick()
  linesEl.value?.querySelector('.lte-word--cursor')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

// ── Keyboard ──

function onKeydown(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) {
    return
  }
  const step = event.shiftKey ? 100 : 10
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  const actions: Record<string, () => void> = {
    ' ': togglePlay,
    'j': stamp,
    'k': stampEnd,
    'arrowleft': () => {
      cursor.value = previousWord(doc.value, cursor.value) ?? cursor.value
    },
    'arrowright': () => {
      cursor.value = nextWord(doc.value, cursor.value) ?? cursor.value
    },
    'arrowup': () => moveLine(-1),
    'arrowdown': () => moveLine(1),
    'a': () => nudge('begin', -step),
    'd': () => nudge('begin', step),
    'z': () => nudge('end', -step),
    'c': () => nudge('end', step),
    'r': replayFromCursor,
    'm': merge,
    'backspace': clear,
    'delete': clear,
    '-': () => stepRate(-1),
    '=': () => stepRate(1),
  }
  let action: (() => void) | undefined
  if (mod && key === 'z') {
    action = event.shiftKey ? redo : undo
  }
  else if (mod && key === 'y') {
    action = redo
  }
  else if (!mod && !event.altKey) {
    action = actions[key]
  }
  if (action) {
    event.preventDefault()
    action()
  }
}

onMounted(() => {
  globalThis.addEventListener('keydown', onKeydown)
  frame = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  globalThis.removeEventListener('keydown', onKeydown)
  cancelAnimationFrame(frame)
})

const laneTicks = computed(() => {
  const { start, span } = laneWindow.value
  const first = Math.ceil(start / 1000) * 1000
  return Array.from({ length: Math.floor((start + span - first) / 1000) + 1 }, (_, i) => first + i * 1000)
})

const laneBars = computed(() => {
  const { start, span } = laneWindow.value
  return (selectedCue.value?.words ?? []).flatMap((word, index) => {
    if (word.begin === undefined) {
      return []
    }
    const end = word.end ?? word.begin + 250
    return [{
      index,
      text: word.text,
      open: word.end === undefined,
      left: (word.begin - start) / span * 100,
      width: Math.max(0.4, (end - word.begin) / span * 100),
    }]
  })
})

function seekOnLane(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const { start, span } = laneWindow.value
  seek(start + (event.clientX - rect.left) / rect.width * span)
}

function lineNumber(index: number): string {
  return (index + 1).toString().padStart(2, '0')
}

function compactTime(ms: number | undefined): string {
  return ms === undefined ? '·' : (ms / 1000).toFixed(2)
}
</script>

<template>
  <div class="lte">
    <header class="lte-transport">
      <button
        type="button"
        class="lte-play"
        :aria-label="isPlaying ? t.pause : t.play"
        @click="togglePlay"
      >
        <svg
          v-if="isPlaying"
          viewBox="0 0 16 16"
          aria-hidden="true"
        ><rect
          x="3"
          y="2"
          width="3.5"
          height="12"
          rx="1"
        /><rect
          x="9.5"
          y="2"
          width="3.5"
          height="12"
          rx="1"
        /></svg>
        <svg
          v-else
          viewBox="0 0 16 16"
          aria-hidden="true"
        ><path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z" /></svg>
      </button>
      <div class="lte-clock">
        <span
          ref="timecodeEl"
          class="lte-timecode"
        >0:00.000</span>
        <span class="lte-duration">/ {{ formatTimecode(duration * 1000) }}</span>
      </div>
      <div
        class="lte-rates"
        role="group"
        :aria-label="t.rate"
      >
        <button
          v-for="value in RATES"
          :key="value"
          type="button"
          class="lte-rate"
          :class="{ 'lte-rate--on': rate === value }"
          @click="setRate(value)"
        >
          {{ value }}×
        </button>
      </div>
      <div class="lte-meter">
        <span class="lte-meter-label">{{ timedWords === totalWords && totalWords > 0 ? t.done : t.progress }}</span>
        <span class="lte-meter-count">{{ timedWords }}<span>/{{ totalWords }}</span></span>
        <span
          class="lte-meter-bar"
          :style="{ '--fill': totalWords ? timedWords / totalWords : 0 }"
        />
      </div>
      <div class="lte-history">
        <button
          type="button"
          class="lte-ghost"
          :disabled="!canUndo"
          :title="`${t.undo} (Ctrl+Z)`"
          @click="undo"
        >
          ↶
        </button>
        <button
          type="button"
          class="lte-ghost"
          :disabled="!canRedo"
          :title="`${t.redo} (Ctrl+Shift+Z)`"
          @click="redo"
        >
          ↷
        </button>
      </div>
    </header>

    <section
      class="lte-lane"
      @click="seekOnLane"
    >
      <span
        v-for="mark in laneTicks"
        :key="mark"
        class="lte-tick"
        :style="{ left: `${(mark - laneWindow.start) / laneWindow.span * 100}%` }"
      >{{ formatTimecode(mark).slice(0, -4) }}</span>
      <button
        v-for="bar in laneBars"
        :key="bar.index"
        type="button"
        class="lte-bar"
        :class="{ 'lte-bar--cursor': bar.index === cursor.word, 'lte-bar--open': bar.open }"
        :style="{ left: `${bar.left}%`, width: `${bar.width}%` }"
        @click.stop="select({ cue: cursor.cue, word: bar.index })"
      >
        {{ bar.text }}
      </button>
      <span
        ref="playheadEl"
        class="lte-playhead"
      />
    </section>

    <div class="lte-body">
      <ol
        ref="linesEl"
        class="lte-lines"
      >
        <li
          v-if="doc.cues.length === 0"
          class="lte-empty"
        >
          {{ t.empty }}
        </li>
        <li
          v-for="(cue, c) in doc.cues"
          :key="cue.id"
          class="lte-line"
          :class="{ 'lte-line--active': c === activeCue, 'lte-line--selected': c === cursor.cue }"
        >
          <span class="lte-line-num">{{ lineNumber(c) }}</span>
          <span class="lte-line-time">{{ formatTimecode(cue.begin) }}</span>
          <div class="lte-words">
            <button
              v-for="(word, w) in cue.words"
              :key="w"
              type="button"
              class="lte-word"
              :class="{
                'lte-word--timed': word.begin !== undefined,
                'lte-word--cursor': c === cursor.cue && w === cursor.word,
              }"
              :data-begin="word.begin"
              :data-end="word.end"
              @click="select({ cue: c, word: w })"
              @dblclick="word.begin !== undefined && seek(word.begin)"
            >
              <span class="lte-word-text">{{ word.text.trim() || '␣' }}</span>
              <span class="lte-word-time">{{ compactTime(word.begin) }}</span>
            </button>
          </div>
        </li>
      </ol>

      <aside class="lte-inspector">
        <template v-if="selectedWord && selectedCue">
          <p class="lte-caption">
            {{ t.line }} {{ lineNumber(cursor.cue) }} · {{ t.word }} {{ cursor.word + 1 }}/{{ selectedCue.words.length }}
          </p>
          <p
            class="lte-split"
            :title="t.split"
          >
            <template
              v-for="(char, i) in [...selectedWord.text]"
              :key="i"
            >
              <button
                v-if="i > 0"
                type="button"
                class="lte-split-at"
                :aria-label="`${t.split} ${i}`"
                @click="split(i)"
              />
              <span>{{ char === ' ' ? '␣' : char }}</span>
            </template>
          </p>
          <div class="lte-edges">
            <label
              v-for="edge in (['begin', 'end'] as const)"
              :key="edge"
              class="lte-edge"
            >
              <span>{{ edge === 'begin' ? t.begin : t.end }}</span>
              <input
                :value="selectedWord[edge] === undefined ? '' : formatTimecode(selectedWord[edge])"
                :placeholder="t.untimed"
                spellcheck="false"
                @change="setEdge(edge, ($event.target as HTMLInputElement).value)"
              >
            </label>
          </div>
          <div class="lte-actions">
            <button
              type="button"
              class="lte-ghost"
              @click="replayFromCursor"
            >
              {{ t.replay }}
            </button>
            <button
              type="button"
              class="lte-ghost"
              :disabled="cursor.word >= selectedCue.words.length - 1"
              @click="merge"
            >
              {{ t.merge }}
            </button>
            <button
              type="button"
              class="lte-ghost"
              :disabled="selectedWord.begin === undefined"
              @click="clear"
            >
              {{ t.clear }}
            </button>
          </div>
          <label class="lte-text">
            <span>{{ t.lineText }}</span>
            <input
              :value="cueText(selectedCue)"
              spellcheck="false"
              @change="editLineText(($event.target as HTMLInputElement).value)"
            >
          </label>
        </template>

        <dl class="lte-keys">
          <dt class="lte-keys-title">
            {{ t.keys }}
          </dt>
          <div><dt><kbd>J</kbd></dt><dd>{{ t.keyStamp }}</dd></div>
          <div><dt><kbd>K</kbd></dt><dd>{{ t.keyEnd }}</dd></div>
          <div><dt><kbd>Space</kbd></dt><dd>{{ t.keyPlay }}</dd></div>
          <div><dt><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></dt><dd>{{ t.keyMove }}</dd></div>
          <div><dt><kbd>A</kbd><kbd>D</kbd></dt><dd>{{ t.keyNudgeBegin }}</dd></div>
          <div><dt><kbd>Z</kbd><kbd>C</kbd></dt><dd>{{ t.keyNudgeEnd }}</dd></div>
          <div><dt><kbd>R</kbd></dt><dd>{{ t.keyReplay }}</dd></div>
          <div><dt><kbd>M</kbd></dt><dd>{{ t.keyMerge }}</dd></div>
          <div><dt><kbd>⌫</kbd></dt><dd>{{ t.keyClear }}</dd></div>
          <div><dt><kbd>-</kbd><kbd>=</kbd></dt><dd>{{ t.keyRate }}</dd></div>
          <div><dt><kbd>Ctrl</kbd><kbd>Z</kbd></dt><dd>{{ t.keyUndo }}</dd></div>
        </dl>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.lte {
  --lte-bg: var(--bg-primary, #141416);
  --lte-panel: var(--bg-surface, #1a1a1e);
  --lte-raised: var(--bg-elevated, #222226);
  --lte-hover: var(--bg-hover, #28282e);
  --lte-text: var(--text-primary, #ededf0);
  --lte-muted: var(--text-tertiary, #a4a4ae);
  --lte-faint: rgba(255, 255, 255, 0.28);
  --lte-line: var(--border, rgba(255, 255, 255, 0.06));
  --lte-line-strong: var(--border-strong, rgba(255, 255, 255, 0.12));
  --lte-accent: var(--accent, #e8574a);
  --lte-accent-soft: var(--accent-soft, rgba(232, 87, 74, 0.12));
  --lte-timed: #7fd1b9;
  --lte-mono: var(--font-mono, 'Berkeley Mono', 'Sarasa Mono SC', 'Noto Sans Mono CJK SC', ui-monospace, monospace);
  --lte-sans: var(--font-sans, 'Hiragino Sans', 'Noto Sans JP', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  --lte-radius: var(--radius-sm, 0.375rem);

  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--lte-bg);
  color: var(--lte-text);
  font-family: var(--lte-mono);
  font-size: 13px;
}

button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.35;
}

/* ── Transport ── */

.lte-transport {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--lte-line);
  background: var(--lte-panel);
}
.lte-play {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border: none;
  border-radius: 50%;
  background: var(--lte-accent);
  box-shadow: 0 0 0 4px var(--lte-accent-soft);
  transition: transform 120ms ease;
}
.lte-play:active {
  transform: scale(0.94);
}
.lte-play svg {
  width: 1rem;
  height: 1rem;
  fill: #fff;
}
.lte-clock {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  font-variant-numeric: tabular-nums;
}
.lte-timecode {
  font-size: 1.6rem;
  letter-spacing: -0.02em;
  min-width: 8.5ch;
}
.lte-duration {
  color: var(--lte-muted);
}
.lte-rates {
  display: flex;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
  overflow: hidden;
}
.lte-rate {
  padding: 0.3rem 0.55rem;
  border: none;
  background: none;
  color: var(--lte-muted);
}
.lte-rate + .lte-rate {
  border-left: 1px solid var(--lte-line-strong);
}
.lte-rate--on {
  background: var(--lte-raised);
  color: var(--lte-text);
}
.lte-meter {
  display: grid;
  grid-template-columns: auto auto;
  column-gap: 0.75rem;
  align-items: baseline;
  margin-left: auto;
}
.lte-meter-label {
  color: var(--lte-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.lte-meter-count {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.lte-meter-count span {
  color: var(--lte-muted);
}
.lte-meter-bar {
  grid-column: 1 / -1;
  height: 3px;
  margin-top: 0.35rem;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--lte-timed) calc(var(--fill) * 100%), var(--lte-line-strong) 0);
}
.lte-history {
  display: flex;
  gap: 0.25rem;
}
.lte-ghost {
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
  background: none;
  transition: background 120ms ease;
}
.lte-ghost:hover:not(:disabled) {
  background: var(--lte-hover);
}

/* ── Lane ── */

.lte-lane {
  position: relative;
  height: 5.5rem;
  overflow: hidden;
  border-bottom: 1px solid var(--lte-line);
  background:
    repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), var(--lte-line) calc(10% - 1px) 10%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 60%),
    var(--lte-bg);
  cursor: crosshair;
}
.lte-tick {
  position: absolute;
  top: 0.35rem;
  transform: translateX(-50%);
  color: var(--lte-faint);
  font-size: 0.6875rem;
  pointer-events: none;
}
.lte-tick::after {
  content: '';
  position: absolute;
  top: 1.1rem;
  left: 50%;
  height: 0.4rem;
  border-left: 1px solid var(--lte-line-strong);
}
.lte-bar {
  position: absolute;
  top: 2.15rem;
  height: 2.4rem;
  min-width: 2px;
  padding: 0 0.35rem;
  overflow: hidden;
  border: 1px solid rgba(127, 209, 185, 0.5);
  border-radius: 3px;
  background: rgba(127, 209, 185, 0.14);
  color: var(--lte-text);
  font-family: var(--lte-sans);
  font-size: 0.9rem;
  text-align: left;
  white-space: nowrap;
}
.lte-bar--open {
  border-right-style: dashed;
}
.lte-bar--cursor {
  border-color: var(--lte-accent);
  background: var(--lte-accent-soft);
  z-index: 1;
}
.lte-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--lte-accent);
  box-shadow: 0 0 12px var(--lte-accent);
  pointer-events: none;
  z-index: 2;
}

/* ── Lines ── */

.lte-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18rem;
  min-height: 0;
}
.lte-lines {
  margin: 0;
  padding: 0.5rem 0 40vh;
  overflow-y: auto;
  list-style: none;
}
.lte-empty {
  padding: 2rem 1rem;
  color: var(--lte-muted);
}
.lte-line {
  display: grid;
  grid-template-columns: 2.5rem 6.5rem minmax(0, 1fr);
  align-items: start;
  padding: 0.45rem 1rem 0.45rem 0;
  border-left: 2px solid transparent;
}
.lte-line--selected {
  border-left-color: var(--lte-accent);
  background: linear-gradient(90deg, var(--lte-accent-soft), transparent 40%);
}
.lte-line-num {
  padding-top: 0.45rem;
  color: var(--lte-faint);
  font-size: 0.6875rem;
  text-align: right;
  padding-right: 0.75rem;
}
.lte-line-time {
  padding-top: 0.4rem;
  color: var(--lte-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.lte-line--active .lte-line-time {
  color: var(--lte-accent);
}
.lte-words {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.lte-word {
  --p: 0;
  position: relative;
  display: grid;
  justify-items: center;
  min-width: 2rem;
  padding: 0.2rem 0.4rem 0.3rem;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
  background: none;
  overflow: hidden;
  transition: border-color 120ms ease, background 120ms ease;
}
.lte-word:hover {
  background: var(--lte-hover);
}
.lte-word::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: calc(var(--p) * 100%);
  background: var(--lte-accent);
}
.lte-word-text {
  font-family: var(--lte-sans);
  font-size: 1.05rem;
  line-height: 1.4;
  color: var(--lte-muted);
}
.lte-word-time {
  color: var(--lte-faint);
  font-size: 0.625rem;
  font-variant-numeric: tabular-nums;
}
.lte-word--timed {
  border-color: rgba(127, 209, 185, 0.35);
  background: rgba(127, 209, 185, 0.06);
}
.lte-word--timed .lte-word-text {
  color: var(--lte-text);
}
.lte-word--timed .lte-word-time {
  color: var(--lte-timed);
}
.lte-word--cursor {
  border-color: var(--lte-accent);
  box-shadow: 0 0 0 1px var(--lte-accent), 0 0 18px -4px var(--lte-accent);
}

/* ── Inspector ── */

.lte-inspector {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  overflow-y: auto;
  border-left: 1px solid var(--lte-line);
  background: var(--lte-panel);
}
.lte-caption {
  margin: 0;
  color: var(--lte-muted);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
}
.lte-split {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 0;
  font-family: var(--lte-sans);
  font-size: 2rem;
  line-height: 1.2;
}
.lte-split-at {
  width: 0.7rem;
  height: 2rem;
  margin: 0 -0.1rem;
  border: none;
  background: none;
  position: relative;
}
.lte-split-at::before {
  content: '';
  position: absolute;
  inset: 0.2rem 50%;
  border-left: 1px dashed transparent;
}
.lte-split-at:hover::before {
  border-left-color: var(--lte-accent);
}
.lte-edges {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.lte-edge,
.lte-text {
  display: grid;
  gap: 0.3rem;
  color: var(--lte-muted);
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.lte-edge input,
.lte-text input {
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
  background: var(--lte-bg);
  color: var(--lte-text);
  font: inherit;
  font-size: 0.875rem;
  letter-spacing: 0;
  text-transform: none;
  outline: none;
}
.lte-text input {
  font-family: var(--lte-sans);
}
.lte-edge input:focus,
.lte-text input:focus {
  border-color: var(--lte-accent);
}
.lte-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.lte-keys {
  display: grid;
  gap: 0.35rem;
  margin: auto 0 0;
  padding-top: 1rem;
  border-top: 1px solid var(--lte-line);
  font-size: 0.75rem;
}
.lte-keys-title {
  color: var(--lte-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 0.6875rem;
}
.lte-keys div {
  display: grid;
  grid-template-columns: 6.5rem 1fr;
  gap: 0.5rem;
  align-items: center;
}
.lte-keys dt,
.lte-keys dd {
  margin: 0;
}
.lte-keys dd {
  color: var(--lte-muted);
}
kbd {
  display: inline-block;
  min-width: 1.4rem;
  margin-right: 0.2rem;
  padding: 0.05rem 0.3rem;
  border: 1px solid var(--lte-line-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: var(--lte-mono);
  font-size: 0.6875rem;
  text-align: center;
}

@media (max-width: 860px) {
  .lte-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .lte-inspector {
    border-left: none;
    border-top: 1px solid var(--lte-line);
    max-height: 40vh;
  }
  .lte-keys {
    display: none;
  }
  .lte-meter {
    display: none;
  }
}
</style>
