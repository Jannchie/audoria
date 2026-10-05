<script setup lang="ts">
import type { LyricsDoc } from '@audoria/lyrics-core'
import type { AudioSource } from './core/index.js'
import type { EditorLocale } from './messages.js'
import type { Stage } from './session.js'
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import LineStage from './components/LineStage.vue'
import PreviewStage from './components/PreviewStage.vue'
import ShortcutsOverlay from './components/ShortcutsOverlay.vue'
import WordStage from './components/WordStage.vue'
import { editorMessages } from './messages.js'
import { createSession, SESSION_KEY } from './session.js'
import { formatTimecode } from './time.js'

const props = withDefaults(defineProps<{
  /** The document being timed. Edits come back through `update:doc` as drafts. */
  doc: LyricsDoc
  audio: AudioSource
  /** The song's encoded audio, for drawing its waveform; without it the editor works unaided. */
  loadAudioData?: () => Promise<ArrayBuffer>
  locale?: EditorLocale
}>(), { locale: 'zh', loadAudioData: undefined })

const emit = defineEmits<{
  /** Every edit, as a draft: lines may be half timed. Pass it through `finishTiming` to save. */
  'update:doc': [doc: LyricsDoc]
}>()

const t = computed(() => editorMessages(props.locale))
const session = createSession({
  initial: props.doc,
  audio: () => props.audio,
  loadAudioData: props.loadAudioData,
  messages: t,
  onChange: doc => emit('update:doc', doc),
})
provide(SESSION_KEY, session)
const { doc, now, playing, duration, rate, stage, canUndo, canRedo } = session

// A different document from outside (another song) starts over; our own drafts coming back
// through v-model are ignored.
watch(() => props.doc, (incoming) => {
  if (incoming !== doc.value) {
    session.reset(incoming)
  }
})

const STAGES: Array<{ id: Stage, key: string }> = [
  { id: 'line', key: '1' },
  { id: 'word', key: '2' },
  { id: 'preview', key: '3' },
]
const RATES = [0.5, 0.75, 1, 1.25]
function stageLabel(id: Stage): string {
  return { line: t.value.stageLine, word: t.value.stageWord, preview: t.value.stagePreview }[id]
}

// ── Completion: one segment per sung line ──

const segments = computed(() => doc.value.cues.flatMap((cue, index) => cue.words.length === 0 ? [] : [{ index, status: session.statusOf(index) }]))
const counts = computed(() => {
  const result = { word: 0, line: 0, partial: 0, untimed: 0 }
  for (const segment of segments.value) {
    if (segment.status !== 'empty') {
      result[segment.status]++
    }
  }
  return result
})

function openLine(index: number): void {
  session.cursor.value = { cue: index, word: 0 }
}

// ── Transport ──

let frame = 0
function tick(): void {
  now.value = props.audio.currentTime * 1000
  playing.value = !props.audio.paused
  duration.value = props.audio.duration * 1000
  rate.value = props.audio.playbackRate || 1
  frame = requestAnimationFrame(tick)
}

const scrub = ref<HTMLElement | null>(null)
function seekFromPointer(event: PointerEvent): void {
  const rect = scrub.value!.getBoundingClientRect()
  session.seek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * duration.value)
}
function onScrubDown(event: PointerEvent): void {
  scrub.value?.setPointerCapture(event.pointerId)
  seekFromPointer(event)
}
function onScrubMove(event: PointerEvent): void {
  if (scrub.value?.hasPointerCapture(event.pointerId)) {
    seekFromPointer(event)
  }
}
const lineMarks = computed(() => duration.value > 0
  ? doc.value.cues.flatMap(cue => cue.begin === undefined || cue.words.length === 0 ? [] : [cue.begin / duration.value * 100])
  : [])

function stepRate(direction: -1 | 1): void {
  const index = RATES.indexOf(rate.value)
  session.setRate(RATES[Math.min(RATES.length - 1, Math.max(0, (index === -1 ? 2 : index) + direction))])
}

// ── Keyboard: the stage first, then shortcuts that work everywhere ──

const helpOpen = ref(false)

function onKeydown(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) {
    return
  }
  if (helpOpen.value && (event.key === 'Escape' || event.key === '?')) {
    helpOpen.value = false
    event.preventDefault()
    return
  }
  if (session.keyHandler.value?.(event)) {
    event.preventDefault()
    return
  }
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  let handled = true
  if (mod && key === 'z') {
    if (event.shiftKey) {
      session.redo()
    }
    else {
      session.undo()
    }
  }
  else if (mod && key === 'y') {
    session.redo()
  }
  else if (mod || event.altKey) {
    handled = false
  }
  else if (key === ' ' || key === 'p') {
    session.togglePlay()
  }
  else if (event.shiftKey && (key === 'arrowleft' || key === 'arrowright')) {
    session.seek(now.value + (key === 'arrowleft' ? -3000 : 3000))
  }
  else if (key === '-' || key === '=') {
    stepRate(key === '-' ? -1 : 1)
  }
  else if (key === '?') {
    helpOpen.value = true
  }
  else if (STAGES.some(item => item.key === key)) {
    stage.value = STAGES.find(item => item.key === key)!.id
  }
  else {
    handled = false
  }
  if (handled) {
    event.preventDefault()
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
</script>

<template>
  <div class="lte">
    <header class="lte-head">
      <nav
        class="lte-stages"
        role="tablist"
      >
        <button
          v-for="item in STAGES"
          :key="item.id"
          type="button"
          role="tab"
          class="lte-stage"
          :class="{ 'lte-stage--on': stage === item.id }"
          :aria-selected="stage === item.id"
          @click="stage = item.id"
        >
          <span class="lte-stage-key">{{ item.key }}</span>{{ stageLabel(item.id) }}
        </button>
      </nav>

      <div
        class="lte-progress"
        :title="`${t.statusWord} ${counts.word} · ${t.statusLine} ${counts.line} · ${t.statusPartial} ${counts.partial} · ${t.statusUntimed} ${counts.untimed}`"
      >
        <div class="lte-strip">
          <button
            v-for="segment in segments"
            :key="segment.index"
            type="button"
            class="lte-strip-cell"
            :class="[`lte-strip-cell--${segment.status}`, { 'lte-strip-cell--on': segment.index === session.cursor.value.cue }]"
            :aria-label="`${segment.index + 1}`"
            @click="openLine(segment.index)"
          />
        </div>
        <div class="lte-legend">
          <span class="lte-dot lte-dot--word" />{{ t.statusWord }} {{ counts.word }}
          <span class="lte-dot lte-dot--line" />{{ t.statusLine }} {{ counts.line }}
          <template v-if="counts.partial">
            <span class="lte-dot lte-dot--partial" />{{ t.statusPartial }} {{ counts.partial }}
          </template>
          <span class="lte-dot lte-dot--untimed" />{{ t.statusUntimed }} {{ counts.untimed }}
        </div>
      </div>

      <div class="lte-tools">
        <button
          type="button"
          class="lte-icon"
          :disabled="!canUndo"
          :title="`${t.undo} · Ctrl+Z`"
          @click="session.undo()"
        >
          <svg viewBox="0 0 16 16"><path d="M6 3 2.5 6.5 6 10M3 6.5h6.5a4 4 0 0 1 0 8H7" /></svg>
        </button>
        <button
          type="button"
          class="lte-icon"
          :disabled="!canRedo"
          :title="`${t.redo} · Ctrl+Shift+Z`"
          @click="session.redo()"
        >
          <svg viewBox="0 0 16 16"><path d="M10 3l3.5 3.5L10 10m3-3.5H6.5a4 4 0 0 0 0 8H9" /></svg>
        </button>
        <button
          type="button"
          class="lte-icon lte-icon--text"
          :title="t.shortcuts"
          @click="helpOpen = true"
        >
          ?
        </button>
      </div>
    </header>

    <main class="lte-main">
      <LineStage v-if="stage === 'line'" />
      <WordStage v-else-if="stage === 'word'" />
      <PreviewStage v-else />
    </main>

    <footer class="lte-transport">
      <button
        type="button"
        class="lte-play"
        :aria-label="playing ? t.pause : t.play"
        @click="session.togglePlay()"
      >
        <svg
          v-if="playing"
          viewBox="0 0 16 16"
        ><rect
          x="3.5"
          y="2.5"
          width="3"
          height="11"
          rx="1"
        /><rect
          x="9.5"
          y="2.5"
          width="3"
          height="11"
          rx="1"
        /></svg>
        <svg
          v-else
          viewBox="0 0 16 16"
        ><path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.2-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" /></svg>
      </button>
      <span class="lte-clock">{{ formatTimecode(now) }}</span>
      <div
        ref="scrub"
        class="lte-scrub"
        @pointerdown="onScrubDown"
        @pointermove="onScrubMove"
      >
        <span
          v-for="(mark, i) in lineMarks"
          :key="i"
          class="lte-scrub-mark"
          :style="{ left: `${mark}%` }"
        />
        <span
          class="lte-scrub-fill"
          :style="{ width: `${duration ? now / duration * 100 : 0}%` }"
        />
      </div>
      <span class="lte-clock lte-clock--total">{{ formatTimecode(duration) }}</span>
      <div
        class="lte-rates"
        role="group"
        :aria-label="t.rate"
      >
        <button
          v-for="value in RATES"
          :key="value"
          type="button"
          :class="{ 'lte-rate--on': rate === value }"
          @click="session.setRate(value)"
        >
          {{ value }}×
        </button>
      </div>
    </footer>

    <ShortcutsOverlay
      v-if="helpOpen"
      @close="helpOpen = false"
    />
  </div>
</template>

<style scoped>
.lte {
  --lte-bg: var(--bg-primary, #121214);
  --lte-panel: var(--bg-surface, #18181b);
  --lte-raised: var(--bg-elevated, #222226);
  --lte-hover: var(--bg-hover, #28282e);
  --lte-text: var(--text-primary, #ededf0);
  --lte-muted: var(--text-tertiary, #9a9aa4);
  --lte-faint: rgba(255, 255, 255, 0.3);
  --lte-line: var(--border, rgba(255, 255, 255, 0.06));
  --lte-line-strong: var(--border-strong, rgba(255, 255, 255, 0.11));
  --lte-accent: var(--accent, #e8574a);
  --lte-accent-soft: var(--accent-soft, rgba(232, 87, 74, 0.12));
  --lte-word: #7fd1b9;
  --lte-word-soft: rgba(127, 209, 185, 0.12);
  --lte-whole: #e8b86b;
  --lte-whole-soft: rgba(232, 184, 107, 0.12);
  --lte-mono: var(--font-mono, 'Berkeley Mono', 'Sarasa Mono SC', 'Noto Sans Mono CJK SC', ui-monospace, monospace);
  --lte-sans: var(--font-sans, 'Hiragino Sans', 'Noto Sans JP', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  --lte-radius: var(--radius-sm, 0.375rem);

  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  background: var(--lte-bg);
  color: var(--lte-text);
  font-family: var(--lte-mono);
  font-size: 13px;
}

.lte :deep(button) {
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.lte :deep(button:disabled) {
  cursor: default;
  opacity: 0.35;
}

/* ── Head ── */

.lte-head {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--lte-line);
  background: var(--lte-panel);
}
.lte-stages {
  display: flex;
  padding: 3px;
  border: 1px solid var(--lte-line);
  border-radius: calc(var(--lte-radius) + 3px);
  background: var(--lte-bg);
}
.lte-stage {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.85rem;
  border: none;
  border-radius: var(--lte-radius);
  background: none;
  color: var(--lte-muted);
  font-family: var(--lte-sans) !important;
  font-size: 0.875rem !important;
  transition: background 150ms ease, color 150ms ease;
}
.lte-stage:hover {
  color: var(--lte-text);
}
.lte-stage--on {
  background: var(--lte-raised);
  color: var(--lte-text);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 2px 8px rgba(0, 0, 0, 0.25);
}
.lte-stage-key {
  font-family: var(--lte-mono);
  font-size: 0.6875rem;
  color: var(--lte-faint);
}
.lte-stage--on .lte-stage-key {
  color: var(--lte-accent);
}

.lte-progress {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.35rem;
}
.lte-strip {
  display: flex;
  gap: 2px;
  height: 0.5rem;
}
.lte-strip-cell {
  flex: 1;
  min-width: 2px;
  padding: 0;
  border: none;
  border-radius: 1px;
  background: var(--lte-line-strong);
  transition: transform 120ms ease;
}
.lte-strip-cell:hover {
  transform: scaleY(1.6);
}
.lte-strip-cell--word {
  background: var(--lte-word);
}
.lte-strip-cell--line {
  background: var(--lte-whole);
}
.lte-strip-cell--partial {
  background: repeating-linear-gradient(135deg, var(--lte-word) 0 2px, transparent 2px 4px);
}
.lte-strip-cell--on {
  box-shadow: 0 0 0 1px var(--lte-text);
}
.lte-legend {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--lte-muted);
  font-size: 0.6875rem;
}
.lte-dot {
  width: 0.45rem;
  height: 0.45rem;
  margin-left: 0.6rem;
  border-radius: 1px;
}
.lte-dot:first-child {
  margin-left: 0;
}
.lte-dot--word {
  background: var(--lte-word);
}
.lte-dot--line {
  background: var(--lte-whole);
}
.lte-dot--partial {
  background: repeating-linear-gradient(135deg, var(--lte-word) 0 2px, transparent 2px 4px);
}
.lte-dot--untimed {
  background: var(--lte-line-strong);
}

.lte-tools {
  display: flex;
  gap: 0.25rem;
}
.lte-icon {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
  background: none;
  transition: background 120ms ease;
}
.lte-icon:hover:not(:disabled) {
  background: var(--lte-hover);
}
.lte-icon svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.lte-icon--text {
  font-weight: 700;
}

.lte-main {
  position: relative;
  min-height: 0;
  overflow: hidden;
}

/* ── Transport ── */

.lte-transport {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--lte-line);
  background: var(--lte-panel);
}
.lte-play {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
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
  width: 0.95rem;
  height: 0.95rem;
  fill: #fff;
}
.lte-clock {
  min-width: 8.5ch;
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
}
.lte-clock--total {
  min-width: 0;
  color: var(--lte-muted);
  font-size: 0.8125rem;
}
.lte-scrub {
  position: relative;
  flex: 1;
  height: 1.75rem;
  cursor: pointer;
  touch-action: none;
}
.lte-scrub::before {
  content: '';
  position: absolute;
  inset: 50% 0 auto;
  height: 4px;
  margin-top: -2px;
  border-radius: 2px;
  background: var(--lte-line-strong);
}
.lte-scrub-fill {
  position: absolute;
  top: 50%;
  left: 0;
  height: 4px;
  margin-top: -2px;
  border-radius: 2px;
  background: var(--lte-accent);
  pointer-events: none;
}
.lte-scrub-fill::after {
  content: '';
  position: absolute;
  top: -4px;
  right: -6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 3px var(--lte-accent-soft);
}
.lte-scrub-mark {
  position: absolute;
  top: 0.35rem;
  bottom: 0.35rem;
  width: 1px;
  background: var(--lte-faint);
  pointer-events: none;
}
.lte-rates {
  display: flex;
  overflow: hidden;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
}
.lte-rates button {
  padding: 0.3rem 0.5rem;
  border: none;
  background: none;
  color: var(--lte-muted);
  font-size: 0.75rem;
}
.lte-rates button + button {
  border-left: 1px solid var(--lte-line-strong);
}
.lte-rates .lte-rate--on {
  background: var(--lte-raised);
  color: var(--lte-text);
}

@media (max-width: 720px) {
  .lte-head {
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .lte-progress {
    flex-basis: 100%;
    order: 3;
  }
  .lte-legend,
  .lte-clock--total,
  .lte-rates {
    display: none;
  }
}
</style>
