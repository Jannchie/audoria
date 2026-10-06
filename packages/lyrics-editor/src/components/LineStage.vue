<script setup lang="ts">
import type { TimingSuggestion } from '../vocals/suggest.js'
import type { LaneBlock, LaneMarker } from './WaveformLane.vue'
import { cueText } from '@audoria/lyrics-core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { cueStart, incompleteLines, isCreditLine, isSung, lineAt, lineStatus, nextLine, setLineEnd, shiftLine } from '../core/index.js'
import { scrollWithin } from '../scroll.js'
import { useSession, useStageKeys } from '../session.js'
import { formatTimecode } from '../time.js'
import { applyTimingSuggestions, suggestLineTiming } from '../vocals/suggest.js'
import WaveformLane from './WaveformLane.vue'

const session = useSession()
const { doc, now, playing, t, cursor } = session

const target = computed(() => cursor.value.cue)
const listEl = ref<HTMLElement | null>(null)

const playingIndex = computed(() => lineAt(doc.value, now.value))
const remaining = computed(() => incompleteLines(doc.value).length)

// ── Lane: a stretch of the song around the playhead, with what lies ahead in view ──

const LANE_SPAN = 10_000
const LANE_LEAD = 0.3

const zoom = ref(1)
const laneSpan = computed(() => LANE_SPAN / zoom.value)

// Playing, the lane follows the playhead. Paused, it stays where it was, and moves only to bring
// into view a line that is picked, or a place that is sought, outside it.
const pausedCenter = ref(now.value)
const laneCenter = computed(() => playing.value ? now.value : pausedCenter.value)

// Held still while a block is dragged, so the pointer keeps its place on the time axis.
const heldStart = ref<number | null>(null)
// How far the lane has been panned away from where it would sit.
const panOffset = ref(0)
const laneStart = computed(() => heldStart.value ?? Math.max(0, laneCenter.value - laneSpan.value * LANE_LEAD + panOffset.value))

function bringIntoView(ms: number | undefined): void {
  if (ms !== undefined && (ms < laneStart.value || ms > laneStart.value + laneSpan.value)) {
    pausedCenter.value = ms
    panOffset.value = 0
  }
}

watch(playing, (isPlaying) => {
  if (isPlaying) {
    panOffset.value = 0
  }
  else {
    pausedCenter.value = now.value
  }
})
watch(target, (index) => {
  if (playing.value) {
    panOffset.value = 0
  }
  else {
    bringIntoView(cueStart(doc.value.cues[index] ?? { words: [] }))
  }
})
watch(now, (ms) => {
  if (!playing.value) {
    bringIntoView(ms)
  }
})

/** Timed lines in view; a line without an end runs until the next timed line starts. */
const blocks = computed<LaneBlock[]>(() => {
  const timed = doc.value.cues.flatMap((cue, index) => {
    const begin = cue.words.length > 0 ? cueStart(cue) : undefined
    return begin === undefined ? [] : [{ index, cue, begin }]
  })
  const from = laneStart.value
  const to = from + laneSpan.value
  return timed.flatMap(({ index, cue, begin }, i) => {
    const end = cue.end ?? timed[i + 1]?.begin
    return begin < to && (end ?? begin + 300) > from
      ? [{ key: index, label: cueText(cue), begin, end, kind: 'line' as const, selected: index === target.value }]
      : []
  })
})

function onDrag(index: number, edge: 'begin' | 'end' | 'both', deltaMs: number): void {
  if (edge !== 'end') {
    session.apply(shiftLine(doc.value, index, deltaMs), `drag-line:${index}`)
    return
  }
  // Only a line timed as a whole has an end of its own; a word-timed line ends with its last word.
  const end = blocks.value.find(block => block.key === index)?.end
  if (lineStatus(doc.value.cues[index]) === 'line' && end !== undefined) {
    session.apply(setLineEnd(doc.value, index, end + deltaMs), `drag-line-end:${index}`)
  }
}

function onDragging(active: boolean): void {
  heldStart.value = active ? laneStart.value : null
}

// Marks made here, newest last. Backspace takes the last one back through the history and
// replays from just before it.
const marks = ref<Array<{ cue: number, ms: number }>>([])

function stamp(): void {
  const index = target.value
  if (!doc.value.cues[index]?.words.length) {
    return
  }
  session.stampLineNow(index, isSung)
  marks.value.push({ cue: index, ms: session.lastStamp.value!.ms })
}

/** Ends the line being heard now, for a break before the next line starts. */
function stampEnd(): void {
  const index = playingIndex.value
  const cue = doc.value.cues[index]
  const ms = session.currentMs()
  if (cue && lineStatus(cue) === 'line' && ms > cue.begin!) {
    session.apply(setLineEnd(doc.value, index, ms))
    session.markStamp(index, undefined, ms)
    marks.value.push({ cue: index, ms })
    // The line is done: if it was still the one to mark, move on, as a start mark does.
    const next = target.value <= index ? nextLine(doc.value, index, 1, isSung) : null
    if (next !== null) {
      session.selectLine(next)
    }
  }
}

function undoStamp(): void {
  const last = marks.value.pop()
  if (last) {
    session.undo()
    session.selectLine(last.cue)
    session.seek(last.ms - 3000)
  }
}

function replayTarget(): void {
  const previous = nextLine(doc.value, target.value, -1)
  const from = doc.value.cues[target.value]?.begin ?? (previous === null ? undefined : doc.value.cues[previous].begin)
  if (from !== undefined) {
    session.seek(from - 1000)
  }
  session.play()
}

function playFrom(index: number): void {
  const begin = doc.value.cues[index]?.begin
  if (begin !== undefined) {
    session.seek(begin)
    session.play()
  }
}

// ── Suggestions from the vocals, reviewed before they are applied ──

// Null while not reviewing; an empty list says the vocals agree with the timing as it is.
const review = ref<Array<TimingSuggestion & { on: boolean }> | null>(null)

function suggest(): void {
  const analysis = session.vocals.value
  if (analysis) {
    // Clear suggestions start out picked; the less certain ones are left for a listen first.
    review.value = suggestLineTiming(doc.value, analysis).map(item => ({ ...item, on: item.confidence === 'high' }))
  }
}

function applyReview(): void {
  const chosen = review.value?.filter(item => item.on) ?? []
  if (chosen.length > 0) {
    session.apply(applyTimingSuggestions(doc.value, chosen))
  }
  review.value = null
}

function focusSuggestion(item: TimingSuggestion): void {
  session.selectLine(item.cue)
  session.seek(item.to - (item.edge === 'begin' ? 1000 : 2000))
}

const allOn = computed(() => review.value?.every(item => item.on) ?? false)
function toggleAll(): void {
  const on = !allOn.value
  for (const item of review.value ?? []) {
    item.on = on
  }
}

const markers = computed<LaneMarker[]>(() => review.value?.map(item => ({ key: `${item.cue}:${item.edge}`, at: item.to, on: item.on })) ?? [])

const signed = (ms: number): string => `${ms > 0 ? '+' : ''}${ms}`

function onKey(event: KeyboardEvent): boolean {
  if (review.value && event.key === 'Escape') {
    review.value = null
    return true
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }
  const step = event.shiftKey ? 250 : 50
  switch (event.key.toLowerCase()) {
    case '[': {
      stamp()
      return true
    }
    case ']': {
      stampEnd()
      return true
    }
    case 'backspace': {
      undoStamp()
      return true
    }
    case 'arrowup':
    case 'arrowdown': {
      const next = nextLine(doc.value, target.value, event.key === 'ArrowUp' ? -1 : 1)
      if (next !== null) {
        session.selectLine(next)
      }
      return true
    }
    case 'a': {
      session.nudgeLine(target.value, -step)
      return true
    }
    case 'd': {
      session.nudgeLine(target.value, step)
      return true
    }
    case 'enter':
    case 'r': {
      replayTarget()
      return true
    }
    default: {
      return false
    }
  }
}
useStageKeys(session, onKey)

watch(target, async () => {
  await nextTick()
  scrollWithin(listEl.value, listEl.value?.querySelector('.ls-line--target'), 'center', 'smooth')
})

onMounted(() => {
  session.loadPeaks()
  // Pick up where marking left off: the first sung line without a time, unless the selected
  // line still needs one.
  const current = doc.value.cues[target.value]
  if (!current || current.words.length === 0 || !isSung(current) || current.begin !== undefined) {
    const open = doc.value.cues.findIndex(cue => cue.words.length > 0 && isSung(cue) && cue.begin === undefined)
    const next = open === -1 ? nextLine(doc.value, -1, 1, isSung) : open
    if (next !== null) {
      session.selectLine(next)
    }
  }
  void nextTick(() => scrollWithin(listEl.value, listEl.value?.querySelector('.ls-line--target'), 'center'))
})
</script>

<template>
  <div class="ls">
    <div class="ls-hint">
      <kbd>Space</kbd>
      <span>{{ playing ? t.pause : t.play }}</span>
      <kbd>[</kbd>
      <span>{{ t.lineKeyStart }}</span>
      <kbd>]</kbd>
      <span>{{ t.lineKeyEnd }}</span>
      <span class="ls-hint-spacer" />
      <button
        type="button"
        class="ls-suggest"
        :disabled="!session.vocals.value"
        :title="session.vocals.value ? t.suggestRunHint : t.suggestNeedVocals"
        @click="suggest"
      >
        {{ t.suggestRun }}
      </button>
      <span class="ls-count">{{ remaining }} {{ t.lines }}</span>
    </div>

    <div class="ls-lane">
      <WaveformLane
        v-model:zoom="zoom"
        :start="laneStart"
        :span="laneSpan"
        :blocks="blocks"
        :markers="markers"
        @select="session.selectLine"
        @drag="onDrag"
        @dragging="onDragging"
        @seek="session.seek"
        @pan="panOffset += $event"
      />
    </div>

    <ol
      ref="listEl"
      class="ls-list"
    >
      <li
        v-if="doc.cues.length === 0"
        class="ls-empty-doc"
      >
        {{ t.emptyDoc }}
      </li>
      <li
        v-for="(cue, i) in doc.cues"
        :key="cue.id"
        class="ls-line"
        :class="{
          'ls-line--blank': cue.words.length === 0,
          'ls-line--credit': isCreditLine(cue),
          'ls-line--target': i === target,
          'ls-line--playing': i === playingIndex,
          'ls-line--timed': cue.begin !== undefined,
          'ls-line--past': playingIndex >= 0 && i < playingIndex,
        }"
        @click="cue.words.length > 0 && session.selectLine(i)"
        @dblclick="playFrom(i)"
      >
        <template v-if="cue.words.length > 0">
          <button
            v-if="cue.begin !== undefined"
            type="button"
            class="ls-time ls-play"
            :title="t.linePlayFrom"
            @click.stop="playFrom(i)"
          >
            <span class="ls-play-icon">▶</span>{{ formatTimecode(cue.begin) }}
          </button>
          <span
            v-else
            class="ls-time"
          >—</span>
          <span
            :key="session.isFlashing(i) ? session.lastStamp.value!.at : 0"
            class="ls-text"
            :class="{ 'ls-text--flash': session.isFlashing(i) }"
          >
            {{ cueText(cue) }}
            <span
              v-if="isCreditLine(cue)"
              class="ls-tag"
            >{{ t.credit }}</span>
          </span>
        </template>
        <span
          v-else
          class="ls-blank"
        />
      </li>
    </ol>

    <section
      v-if="review"
      class="ls-review"
    >
      <header class="ls-review-head">
        <span>{{ t.suggestTitle }} · {{ review.length }}</span>
        <button
          v-if="review.length > 0"
          type="button"
          class="ls-review-all"
          @click="toggleAll"
        >
          {{ t.suggestAll }}
        </button>
      </header>
      <p
        v-if="review.length === 0"
        class="ls-review-none"
      >
        {{ t.suggestNone }}
      </p>
      <ul
        v-else
        class="ls-review-list"
      >
        <li
          v-for="item in review"
          :key="`${item.cue}:${item.edge}`"
          class="ls-review-item"
          :class="{ 'ls-review-item--on': item.on }"
        >
          <input
            v-model="item.on"
            type="checkbox"
            :aria-label="`${item.cue + 1} ${item.edge === 'begin' ? t.suggestBegin : t.suggestEnd}`"
          >
          <button
            type="button"
            class="ls-review-line"
            @click="focusSuggestion(item)"
          >
            <span class="ls-review-num">{{ String(item.cue + 1).padStart(2, '0') }}</span>
            <span class="ls-review-edge">{{ item.edge === 'begin' ? t.suggestBegin : t.suggestEnd }}</span>
            <span class="ls-review-text">{{ cueText(doc.cues[item.cue]) }}</span>
            <span
              class="ls-review-delta"
              :title="item.from === undefined ? formatTimecode(item.to) : `${formatTimecode(item.from)} → ${formatTimecode(item.to)}`"
            >{{ item.from === undefined ? formatTimecode(item.to) : `${signed(item.to - item.from)} ms` }}</span>
            <span
              v-if="item.confidence === 'low'"
              class="ls-review-low"
              :title="t.suggestLow"
            >?</span>
          </button>
        </li>
      </ul>
      <footer class="ls-review-foot">
        <button
          type="button"
          class="ls-undo"
          @click="review = null"
        >
          {{ t.suggestCancel }}
        </button>
        <button
          v-if="review.length > 0"
          type="button"
          class="ls-review-apply"
          :disabled="!review.some(item => item.on)"
          @click="applyReview"
        >
          {{ t.suggestApply }} · {{ review.filter(item => item.on).length }}
        </button>
      </footer>
    </section>

    <div class="ls-pad">
      <button
        type="button"
        class="ls-undo"
        :disabled="marks.length === 0"
        @click="undoStamp"
      >
        <kbd>⌫</kbd> {{ t.lineUndo }}
      </button>
      <button
        type="button"
        class="ls-tap"
        @pointerdown.prevent="stamp"
      >
        {{ t.lineTap }}
        <kbd>[</kbd>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ls {
  position: relative;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  height: 100%;
}

.ls-hint {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem 1.25rem;
  color: var(--lte-muted);
  font-family: var(--lte-sans);
  font-size: 0.8125rem;
}
.ls-hint-spacer {
  flex: 1;
}
.ls-suggest {
  padding: 0.25rem 0.7rem;
  border: 1px solid rgba(127, 209, 185, 0.45);
  border-radius: 999px;
  background: none;
  color: var(--lte-word) !important;
  font-family: var(--lte-sans) !important;
  font-size: 0.75rem !important;
}
.ls-suggest:hover:not(:disabled) {
  background: var(--lte-word-soft);
}
.ls-suggest:disabled {
  border-color: var(--lte-line-strong);
  color: var(--lte-faint) !important;
}

.ls-review {
  position: absolute;
  right: 1.25rem;
  bottom: 5.5rem;
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: min(30rem, calc(100% - 2.5rem));
  max-height: 55%;
  border: 1px solid var(--lte-line-strong);
  border-radius: calc(var(--lte-radius) + 4px);
  background: var(--lte-raised);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  font-family: var(--lte-sans);
}
.ls-review-head,
.ls-review-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 0.9rem;
}
.ls-review-head {
  border-bottom: 1px solid var(--lte-line);
  font-size: 0.8125rem;
}
.ls-review-all {
  padding: 0;
  border: none;
  background: none;
  color: var(--lte-accent) !important;
  font-family: inherit !important;
  font-size: 0.75rem !important;
}
.ls-review-foot {
  justify-content: flex-end;
  border-top: 1px solid var(--lte-line);
}
.ls-review-none {
  margin: 0;
  padding: 1rem 0.9rem;
  color: var(--lte-muted);
  font-size: 0.8125rem;
}
.ls-review-list {
  margin: 0;
  padding: 0.3rem 0;
  overflow-y: auto;
  list-style: none;
}
.ls-review-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.9rem;
  opacity: 0.6;
}
.ls-review-item--on {
  opacity: 1;
}
.ls-review-item input {
  accent-color: var(--lte-word);
}
.ls-review-line {
  display: grid;
  grid-template-columns: 1.5rem 2.5rem minmax(0, 1fr) auto 0.8rem;
  align-items: baseline;
  flex: 1;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.35rem 0.4rem;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--lte-text) !important;
  font-family: inherit !important;
  font-size: 0.8125rem !important;
  text-align: left;
}
.ls-review-line:hover {
  background: var(--lte-hover);
}
.ls-review-num,
.ls-review-delta {
  color: var(--lte-muted);
  font-family: var(--lte-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.ls-review-edge {
  color: var(--lte-word);
  font-size: 0.75rem;
}
.ls-review-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ls-review-low {
  color: var(--lte-whole);
  font-family: var(--lte-mono);
  font-size: 0.75rem;
}
.ls-review-apply {
  padding: 0.5rem 1.1rem;
  border: none;
  border-radius: 999px;
  background: var(--lte-word);
  color: var(--lte-bg) !important;
  font-family: var(--lte-sans) !important;
  font-weight: 600;
}
.ls-review-apply:disabled {
  opacity: 0.4;
}

.ls-count {
  font-family: var(--lte-mono);
  font-size: 0.75rem;
}

.ls-lane {
  padding-bottom: 0.5rem;
}
/* Edge to edge: the waveform is a timeline, not a card. */
.ls-lane :deep(.wl) {
  border-right: none;
  border-left: none;
  border-radius: 0;
}

.ls-list {
  margin: 0;
  padding: 30vh 1.25rem 35vh;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: none;
  mask-image: linear-gradient(transparent, #000 18%, #000 78%, transparent);
}
.ls-empty-doc {
  color: var(--lte-muted);
  text-align: center;
}

.ls-line {
  display: grid;
  grid-template-columns: 7.5rem minmax(0, 1fr);
  align-items: center;
  gap: 1.25rem;
  max-width: 54rem;
  margin: 0 auto;
  padding: 0.45rem 0.75rem;
  border-radius: var(--lte-radius);
  cursor: pointer;
  transition: background 160ms ease;
}
.ls-line:hover {
  background: rgba(255, 255, 255, 0.025);
}
.ls-line--blank {
  cursor: default;
  padding: 0.6rem 0.75rem;
}
.ls-blank {
  grid-column: 2;
  width: 2.5rem;
  border-top: 1px dashed var(--lte-line-strong);
}

.ls-time {
  justify-self: end;
  color: var(--lte-faint);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  transition: color 160ms ease;
}
.ls-play {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.1rem 0.35rem;
  margin: -0.1rem -0.35rem;
  border: none;
  border-radius: 4px;
  background: none;
  font-family: inherit;
  cursor: pointer;
}
.ls-play-icon {
  font-size: 0.625rem;
  opacity: 0;
  transition: opacity 120ms ease;
}
.ls-line:hover .ls-play-icon,
.ls-play:focus-visible .ls-play-icon {
  opacity: 1;
}
.ls-play:hover {
  background: var(--lte-hover);
  color: var(--lte-text) !important;
}
.ls-line--timed .ls-time {
  color: var(--lte-whole);
}

.ls-text {
  position: relative;
  color: var(--lte-muted);
  font-family: var(--lte-sans);
  font-size: 1.2rem;
  line-height: 1.5;
  transition: color 200ms ease;
}
.ls-line--past .ls-text {
  color: rgba(255, 255, 255, 0.38);
}
.ls-line--playing .ls-text {
  color: var(--lte-text);
}
.ls-line--credit .ls-text {
  font-size: 0.95rem;
}

.ls-line--target {
  position: relative;
  background: linear-gradient(90deg, var(--lte-accent-soft), transparent 70%);
}
.ls-line--target::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.4rem;
  bottom: 0.4rem;
  width: 3px;
  border-radius: 2px;
  background: var(--lte-accent);
}
.ls-line--target .ls-text {
  color: var(--lte-text);
  font-weight: 600;
}
.ls-line--target .ls-time {
  color: var(--lte-accent);
}

.ls-text--flash::after {
  content: '';
  position: absolute;
  inset: -0.2rem -0.6rem;
  border-radius: var(--lte-radius);
  background: var(--lte-whole);
  opacity: 0;
  animation: ls-flash 520ms ease-out;
  pointer-events: none;
}
@keyframes ls-flash {
  from {
    opacity: 0.35;
  }
  to {
    opacity: 0;
  }
}

.ls-tag {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.05rem 0.4rem;
  border: 1px solid var(--lte-line-strong);
  border-radius: 999px;
  color: var(--lte-muted);
  font-family: var(--lte-mono);
  font-size: 0.625rem;
  font-weight: 400;
  vertical-align: middle;
}

.ls-pad {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.75rem 1.25rem 1rem;
}
.ls-undo,
.ls-tap {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  border-radius: 999px;
  font-family: var(--lte-sans) !important;
}
.ls-undo {
  padding: 0.6rem 1rem;
  border: 1px solid var(--lte-line-strong);
  background: none;
  color: var(--lte-muted) !important;
}
.ls-tap {
  min-width: 14rem;
  justify-content: center;
  padding: 0.75rem 1.75rem;
  border: none;
  background: var(--lte-text);
  color: var(--lte-bg) !important;
  font-size: 1rem !important;
  font-weight: 600;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  transition: transform 90ms ease;
  touch-action: manipulation;
}
.ls-tap:active {
  transform: scale(0.97);
}
.ls-tap kbd {
  border-color: rgba(0, 0, 0, 0.2);
  color: rgba(0, 0, 0, 0.55);
}

kbd {
  display: inline-block;
  padding: 0.05rem 0.4rem;
  border: 1px solid var(--lte-line-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: var(--lte-mono);
  font-size: 0.6875rem;
  font-weight: 400;
}

@media (max-width: 720px) {
  .ls-line {
    grid-template-columns: 4.5rem minmax(0, 1fr);
    gap: 0.75rem;
  }
  .ls-tap {
    flex: 1;
    padding: 1.1rem;
  }
  .ls-undo kbd,
  .ls-tap kbd {
    display: none;
  }
}
</style>
