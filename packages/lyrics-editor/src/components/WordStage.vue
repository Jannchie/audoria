<script setup lang="ts">
import type { WordRef } from '../core/index.js'
import type { LaneBlock } from './WaveformLane.vue'
import { cueText } from '@audoria/lyrics-core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearTiming, cueStart, dragWord, incompleteLines, isCreditLine, isSung, lineStatus, mergeWithNext, nextLine, setCueText, splitWord, stampWordEnd, stampWordStart, wordAt } from '../core/index.js'
import { scrollWithin } from '../scroll.js'
import { useSession, useStageKeys } from '../session.js'
import WaveformLane from './WaveformLane.vue'

type Filter = 'all' | 'word' | 'line' | 'todo'

const session = useSession()
const { doc, now, t, cursor } = session

const filter = ref<Filter>('all')
const zoom = ref(1)
const listEl = ref<HTMLElement | null>(null)

const cueIndex = computed(() => cursor.value.cue)
const cue = computed(() => doc.value.cues[cueIndex.value])
const word = computed(() => wordAt(doc.value, cursor.value))

const todo = computed(() => new Set(incompleteLines(doc.value)))
const visibleLines = computed(() => doc.value.cues.flatMap((item, index) => {
  if (item.words.length === 0) {
    return []
  }
  const status = lineStatus(item)
  const show = filter.value === 'all'
    || (filter.value === 'word' && (status === 'word' || status === 'partial'))
    || (filter.value === 'line' && status === 'line')
    || (filter.value === 'todo' && todo.value.has(index))
  return show ? [{ index, cue: item, status }] : []
}))

function selectWord(index: number): void {
  if (index >= 0 && index < (cue.value?.words.length ?? 0)) {
    cursor.value = { cue: cueIndex.value, word: index }
  }
}

/** When the next line starts, for where an untimed or whole line's block ends. */
function followingStart(index: number): number | undefined {
  for (let next = nextLine(doc.value, index, 1); next !== null; next = nextLine(doc.value, next, 1)) {
    const start = cueStart(doc.value.cues[next])
    if (start !== undefined) {
      return start
    }
  }
  return undefined
}

// ── Lane window: fitted to the selected line, then left where it is while that line stays in
// view, so picking a word of a neighbouring line in the lane doesn't move it ──

// An untimed line is shown around where playback was when it was picked, not where it is now:
// following the playhead would move the window, and redraw the waveform, every frame.
const anchor = ref(now.value)

/** Where a line's words lie, and the window that shows them with some air around. */
function fitLine(index: number): { low: number, high: number, center: number, span: number } {
  const line = doc.value.cues[index]
  if (!line) {
    return { low: 0, high: 6000, center: 3000, span: 6000 }
  }
  const times = line.words.flatMap(item => [item.begin, item.end]).filter((time): time is number => time !== undefined)
  const low = times.length > 0 ? Math.min(...times) : line.begin ?? anchor.value
  const high = Math.max(times.length > 0 ? Math.max(...times) : line.end ?? followingStart(index) ?? low + 3000, low + 2500)
  const pad = (high - low) * 0.12 + 400
  return { low, high, center: (low + high) / 2, span: high - low + pad * 2 }
}

// The window's middle, and its width before zooming.
const initial = fitLine(cueIndex.value)
const center = ref(initial.center)
const baseSpan = ref(initial.span)

// Held still while a block is dragged, so the pointer keeps its place on the time axis.
const heldWindow = ref<{ start: number, span: number } | null>(null)
const window_ = computed(() => {
  if (heldWindow.value) {
    return heldWindow.value
  }
  const span = baseSpan.value / zoom.value
  return { start: Math.max(0, center.value - span / 2), span }
})

/**
 * Fits the window to the selected line, unless the selected word (or, while untimed, the line)
 * is in view already: a word picked in the lane, even of another line, is.
 */
function bringLineIntoView(index: number): void {
  const fit = fitLine(index)
  const { start, span } = window_.value
  const at = doc.value.cues[index]?.words[cursor.value.word]?.begin
  const visible = at === undefined
    ? fit.low >= start && fit.high <= start + span
    : at >= start && at <= start + span
  if (!visible) {
    center.value = fit.center
    baseSpan.value = fit.span
    zoom.value = 1
  }
}

function onDragging(active: boolean): void {
  heldWindow.value = active ? { ...window_.value } : null
}

// Blocks are keyed by line and word, so the lane can show (and grab) the lines around this one.
const WORDS_PER_LINE = 10_000
const toKey = (ref: WordRef): number => ref.cue * WORDS_PER_LINE + ref.word
const fromKey = (key: number): WordRef => ({ cue: Math.floor(key / WORDS_PER_LINE), word: key % WORDS_PER_LINE })

const blocks = computed<LaneBlock[]>(() => {
  const { start, span } = window_.value
  return doc.value.cues.flatMap((line, cueAt) => line.words.flatMap((item, index) => {
    const end = item.end ?? item.begin
    if (item.begin === undefined || item.begin > start + span || end! < start) {
      return []
    }
    const own = cueAt === cueIndex.value
    return [{ key: toKey({ cue: cueAt, word: index }), label: item.text.trim() || '␣', begin: item.begin, end: item.end, kind: 'word' as const, selected: own && index === cursor.value.word, muted: !own }]
  }))
})

function onLaneSelect(key: number): void {
  cursor.value = fromKey(key)
}

function onDrag(key: number, edge: 'begin' | 'end' | 'both', deltaMs: number, detach: boolean): void {
  session.apply(dragWord(doc.value, fromKey(key), edge, deltaMs, { detach }), `drag:${key}:${edge}`)
}

// The lines either side of this one, shown faintly around its words.
const previousLine = computed(() => nextLine(doc.value, cueIndex.value, -1))
const followingLine = computed(() => nextLine(doc.value, cueIndex.value, 1))

// ── Editing ──

// ── Hold to time: [ goes down as a word starts and comes up as it ends ──

// A press shorter than this is a tap, which leaves the word's end to the next word's start.
const TAP_MS = 120
// A press this soon after the last release is the next word sung straight on: the two words join.
const JOIN_MS = 150

// The word being held, and when its key went down (wall clock).
const holding = ref<{ ref: WordRef, at: number, group: string } | null>(null)
// The last word ended by a release, to join to the next one if it follows straight on.
let released: { ref: WordRef, ms: number, at: number } | null = null

function stamp(): void {
  if (!cue.value?.words.length) {
    return
  }
  const at = cursor.value
  const ms = session.currentMs()
  const group = `hold:${at.cue}:${at.word}:${performance.now()}`
  let next = stampWordStart(doc.value, at, ms).doc
  if (released && released.ref.cue === at.cue && released.ref.word === at.word - 1 && performance.now() - released.at <= JOIN_MS) {
    next = stampWordEnd(next, released.ref, ms)
  }
  released = null
  session.apply(next, group)
  holding.value = { ref: at, at: performance.now(), group }
  if (at.word + 1 < cue.value.words.length) {
    selectWord(at.word + 1)
  }
  else {
    // Past a line's last word, carry on into the next sung line.
    const following = nextLine(doc.value, at.cue, 1, isSung)
    if (following !== null) {
      session.selectLine(following)
    }
  }
  session.markStamp(at.cue, at.word, ms, cursor.value)
}

/** The held word ends where its key comes up, unless the press was only a tap. */
function release(): void {
  const held = holding.value
  holding.value = null
  if (!held || performance.now() - held.at < TAP_MS) {
    return
  }
  const ms = session.currentMs()
  session.apply(stampWordEnd(doc.value, held.ref, ms), held.group)
  released = { ref: held.ref, ms, at: performance.now() }
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key === '[' && holding.value) {
    release()
  }
}

function stampEnd(): void {
  const last = session.lastStamp.value
  // The word just marked, as long as the cursor hasn't been moved since, even onto the next line.
  const target = last?.word !== undefined && last.after?.cue === cursor.value.cue && last.after.word === cursor.value.word
    ? { cue: last.cue, word: last.word }
    : { cue: cueIndex.value, word: Math.max(0, cursor.value.word - 1) }
  session.apply(stampWordEnd(doc.value, target, session.currentMs()))
}

function nudge(edge: 'begin' | 'end', deltaMs: number): void {
  session.apply(dragWord(doc.value, cursor.value, edge, deltaMs), `nudge:${cursor.value.cue}:${cursor.value.word}:${edge}`)
}

function replayLine(): void {
  const start = cue.value && cueStart(cue.value)
  if (start !== undefined) {
    session.seek(start - 600)
  }
  session.play()
}

function editText(text: string): void {
  if (cue.value && text !== cueText(cue.value)) {
    session.apply(setCueText(doc.value, cueIndex.value, text))
    selectWord(0)
  }
}

function moveLine(direction: 1 | -1): void {
  const list = visibleLines.value
  const position = list.findIndex(item => item.index === cueIndex.value)
  const next = list[position + direction] ?? (position === -1 ? list[0] : undefined)
  if (next) {
    session.selectLine(next.index)
  }
}

function onKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }
  const step = event.shiftKey ? 100 : 10
  switch (event.key.toLowerCase()) {
    case '[': {
      // The key repeats while held; only its first press starts a word.
      if (!event.repeat) {
        stamp()
      }
      return true
    }
    case ']': {
      stampEnd()
      return true
    }
    case 'r': {
      replayLine()
      return true
    }
    case 'm': {
      session.apply(mergeWithNext(doc.value, cursor.value))
      return true
    }
    case 'backspace':
    case 'delete': {
      session.apply(clearTiming(doc.value, cursor.value))
      return true
    }
    case 'a':
    case 'd': {
      nudge('begin', event.key.toLowerCase() === 'a' ? -step : step)
      return true
    }
    case 'z':
    case 'c': {
      nudge('end', event.key.toLowerCase() === 'z' ? -step : step)
      return true
    }
    case 'arrowup':
    case 'arrowdown': {
      moveLine(event.key === 'ArrowUp' ? -1 : 1)
      return true
    }
    case 'arrowleft':
    case 'arrowright': {
      if (event.shiftKey) {
        return false
      }
      selectWord(cursor.value.word + (event.key === 'ArrowLeft' ? -1 : 1))
      return true
    }
    default: {
      return false
    }
  }
}
useStageKeys(session, onKey)

watch(cueIndex, async (index) => {
  anchor.value = now.value
  bringLineIntoView(index)
  await nextTick()
  scrollWithin(listEl.value, listEl.value?.querySelector('.ws-item--on'), 'nearest', 'smooth')
})

onMounted(() => {
  // Releases go straight to the stage: the shell routes only key presses.
  globalThis.addEventListener('keyup', onKeyUp, true)
  globalThis.addEventListener('blur', release)
  session.loadPeaks()
  if (!cue.value?.words.length) {
    const first = nextLine(doc.value, -1, 1)
    if (first !== null) {
      session.selectLine(first)
    }
  }
})
onBeforeUnmount(() => {
  globalThis.removeEventListener('keyup', onKeyUp, true)
  globalThis.removeEventListener('blur', release)
})
</script>

<template>
  <div class="ws">
    <aside class="ws-side">
      <div
        class="ws-filters"
        role="tablist"
      >
        <button
          v-for="item in (['all', 'todo', 'word', 'line'] as const)"
          :key="item"
          type="button"
          class="ws-filter"
          :class="{ 'ws-filter--on': filter === item }"
          @click="filter = item"
        >
          {{ { all: t.filterAll, todo: t.filterTodo, word: t.filterWord, line: t.filterLine }[item] }}
          <span v-if="item === 'todo' && todo.size > 0">{{ todo.size }}</span>
        </button>
      </div>
      <ol
        ref="listEl"
        class="ws-list"
      >
        <li
          v-if="visibleLines.length === 0"
          class="ws-none"
        >
          {{ t.noLines }}
        </li>
        <li
          v-for="item in visibleLines"
          :key="item.cue.id"
        >
          <button
            type="button"
            class="ws-item"
            :class="{ 'ws-item--on': item.index === cueIndex }"
            @click="session.selectLine(item.index)"
          >
            <span
              class="ws-status"
              :class="`ws-status--${item.status}`"
            />
            <span class="ws-num">{{ String(item.index + 1).padStart(2, '0') }}</span>
            <span class="ws-text">{{ cueText(item.cue) }}</span>
            <span
              v-if="isCreditLine(item.cue)"
              class="ws-tag"
            >{{ t.credit }}</span>
          </button>
        </li>
      </ol>
    </aside>

    <section
      v-if="cue && cue.words.length > 0"
      class="ws-main"
    >
      <header class="ws-head">
        <span class="ws-head-num">{{ String(cueIndex + 1).padStart(2, '0') }}</span>
        <input
          class="ws-head-text"
          :value="cueText(cue)"
          spellcheck="false"
          @change="editText(($event.target as HTMLInputElement).value)"
        >
        <button
          type="button"
          class="ws-ghost"
          title="R"
          @click="replayLine"
        >
          ↺ {{ t.replayLine }}
        </button>
      </header>

      <div class="ws-lane">
        <WaveformLane
          v-model:zoom="zoom"
          :start="window_.start"
          :span="window_.span"
          :blocks="blocks"
          guides
          @select="onLaneSelect"
          @drag="onDrag"
          @dragging="onDragging"
          @seek="session.seek"
          @pan="center += $event"
        />
      </div>

      <p class="ws-hint">
        {{ t.modeWordHint }}
      </p>
      <button
        v-if="previousLine !== null"
        type="button"
        class="ws-context"
        @click="session.selectLine(previousLine)"
      >
        <span class="ws-context-num">{{ String(previousLine + 1).padStart(2, '0') }}</span>
        {{ cueText(doc.cues[previousLine]) }}
      </button>
      <div class="ws-words">
        <template
          v-for="(item, w) in cue.words"
          :key="w"
        >
          <button
            v-if="w > 0"
            type="button"
            class="ws-join"
            :title="t.merge"
            @click="session.apply(mergeWithNext(doc, { cue: cueIndex, word: w - 1 }))"
          />
          <button
            type="button"
            class="ws-word"
            :class="{
              'ws-word--timed': item.begin !== undefined,
              'ws-word--on': w === cursor.word,
              'ws-word--held': holding?.ref.cue === cueIndex && holding.ref.word === w,
            }"
            @click="selectWord(w)"
            @dblclick="item.begin !== undefined && session.seek(item.begin)"
          >
            <span
              v-if="session.isFlashing(cueIndex, w)"
              :key="session.lastStamp.value!.at"
              class="ws-flash"
            />
            <span class="ws-word-text">{{ item.text.trim() || '␣' }}</span>
            <span class="ws-word-time">{{ item.begin === undefined ? '·' : (item.begin / 1000).toFixed(2) }}</span>
          </button>
        </template>
      </div>

      <div
        v-if="word"
        class="ws-detail"
      >
        <p
          class="ws-split"
          :title="t.splitHere"
        >
          <template
            v-for="(char, i) in [...word.text]"
            :key="i"
          >
            <button
              v-if="i > 0"
              type="button"
              class="ws-split-at"
              :aria-label="t.splitHere"
              @click="session.apply(splitWord(doc, cursor, i))"
            />
            <span>{{ char === ' ' ? '␣' : char }}</span>
          </template>
        </p>
      </div>
      <button
        v-if="followingLine !== null"
        type="button"
        class="ws-context"
        @click="session.selectLine(followingLine)"
      >
        <span class="ws-context-num">{{ String(followingLine + 1).padStart(2, '0') }}</span>
        {{ cueText(doc.cues[followingLine]) }}
      </button>
    </section>
    <p
      v-else
      class="ws-empty"
    >
      {{ t.emptyDoc }}
    </p>
  </div>
</template>

<style scoped>
.ws {
  display: grid;
  grid-template-columns: 17rem minmax(0, 1fr);
  height: 100%;
}

/* ── Line list ── */

.ws-side {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  border-right: 1px solid var(--lte-line);
  background: var(--lte-panel);
}
.ws-filters {
  display: flex;
  gap: 0.25rem;
  padding: 0.6rem;
  border-bottom: 1px solid var(--lte-line);
}
.ws-filter {
  display: inline-flex;
  gap: 0.3rem;
  padding: 0.25rem 0.55rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: none;
  color: var(--lte-muted);
  font-family: var(--lte-sans) !important;
  font-size: 0.75rem !important;
}
.ws-filter span {
  color: var(--lte-accent);
}
.ws-filter--on {
  border-color: var(--lte-line-strong);
  background: var(--lte-raised);
  color: var(--lte-text);
}
.ws-list {
  margin: 0;
  padding: 0.35rem;
  overflow-y: auto;
  list-style: none;
}
.ws-none {
  padding: 1.5rem 0.5rem;
  color: var(--lte-muted);
  font-size: 0.75rem;
  text-align: center;
}
.ws-item {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: var(--lte-radius);
  background: none;
  text-align: left;
}
.ws-item:hover {
  background: var(--lte-hover);
}
.ws-item--on {
  background: var(--lte-accent-soft);
  box-shadow: inset 2px 0 0 var(--lte-accent);
}
.ws-status {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 1px;
  background: var(--lte-line-strong);
}
.ws-status--word {
  background: var(--lte-word);
}
.ws-status--line {
  background: var(--lte-whole);
}
.ws-status--partial {
  background: repeating-linear-gradient(135deg, var(--lte-word) 0 2px, transparent 2px 4px);
}
.ws-num {
  color: var(--lte-faint);
  font-size: 0.6875rem;
}
.ws-text {
  overflow: hidden;
  color: var(--lte-muted);
  font-family: var(--lte-sans);
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-item--on .ws-text {
  color: var(--lte-text);
}
.ws-tag {
  padding: 0 0.35rem;
  border: 1px solid var(--lte-line-strong);
  border-radius: 999px;
  color: var(--lte-muted);
  font-size: 0.5625rem;
}

/* ── Selected line ── */

.ws-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
  padding: 1.25rem 1.5rem;
  overflow-y: auto;
}
.ws-head {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}
.ws-head-num {
  color: var(--lte-accent);
  font-size: 0.875rem;
}
.ws-head-text {
  flex: 1;
  min-width: 0;
  padding: 0.2rem 0.4rem;
  border: 1px solid transparent;
  border-radius: var(--lte-radius);
  background: none;
  color: var(--lte-text);
  font-family: var(--lte-sans);
  font-size: 1.6rem;
  font-weight: 600;
  outline: none;
}
.ws-head-text:hover {
  border-color: var(--lte-line);
}
.ws-head-text:focus {
  border-color: var(--lte-accent);
  background: var(--lte-bg);
}
.ws-ghost {
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
  background: none;
  font-family: var(--lte-sans) !important;
  white-space: nowrap;
}
.ws-ghost:hover:not(:disabled) {
  background: var(--lte-hover);
}

.ws-lane {
  position: relative;
  /* Edge to edge across the pane, past its padding. */
  margin: 0 -1.5rem;
}
.ws-lane :deep(.wl) {
  border-right: none;
  border-left: none;
  border-radius: 0;
}
.ws-context {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.2rem 0;
  border: none;
  background: none;
  color: var(--lte-faint) !important;
  font-family: var(--lte-sans) !important;
  font-size: 0.9375rem !important;
  text-align: left;
}
.ws-context:hover {
  color: var(--lte-muted) !important;
}
.ws-context-num {
  font-family: var(--lte-mono);
  font-size: 0.75rem;
}
.ws-hint {
  margin: 0;
  color: var(--lte-muted);
  font-family: var(--lte-sans);
  font-size: 0.8125rem;
}

.ws-words {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  row-gap: 0.4rem;
}
.ws-word {
  position: relative;
  display: grid;
  justify-items: center;
  min-width: 2.6rem;
  padding: 0.35rem 0.55rem 0.3rem;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
  background: none;
  transition: border-color 120ms ease, background 120ms ease;
}
.ws-word:hover {
  background: var(--lte-hover);
}
.ws-word-text {
  color: var(--lte-muted);
  font-family: var(--lte-sans);
  font-size: 1.4rem;
  line-height: 1.3;
}
.ws-word-time {
  color: var(--lte-faint);
  font-size: 0.625rem;
  font-variant-numeric: tabular-nums;
}
.ws-word--timed {
  border-color: rgba(127, 209, 185, 0.4);
  background: var(--lte-word-soft);
}
.ws-word--timed .ws-word-text {
  color: var(--lte-text);
}
.ws-word--timed .ws-word-time {
  color: var(--lte-word);
}
/* Lit while its key is held down: the word being sung. */
.ws-word--held {
  border-color: var(--lte-word) !important;
  background: var(--lte-word-soft) !important;
  box-shadow: 0 0 0 1px var(--lte-word), 0 0 14px -2px var(--lte-word);
}
.ws-word--on {
  border-color: var(--lte-accent);
  box-shadow: 0 0 0 1px var(--lte-accent), 0 0 20px -6px var(--lte-accent);
}
.ws-flash {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: var(--lte-word);
  opacity: 0;
  animation: ws-flash 420ms ease-out;
  pointer-events: none;
}
@keyframes ws-flash {
  from {
    opacity: 0.45;
  }
  to {
    opacity: 0;
  }
}
.ws-join {
  position: relative;
  width: 0.55rem;
  padding: 0;
  border: none;
  background: none;
}
.ws-join::after {
  content: '+';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--lte-accent);
  font-size: 0.75rem;
  opacity: 0;
  transition: opacity 120ms ease;
}
.ws-join:hover::after {
  opacity: 1;
}

.ws-detail {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--lte-line);
  border-radius: calc(var(--lte-radius) + 2px);
  background: var(--lte-panel);
}
.ws-split {
  display: flex;
  align-items: center;
  margin: 0 0.5rem 0 0;
  font-family: var(--lte-sans);
  font-size: 1.9rem;
  line-height: 1.1;
}
.ws-split-at {
  position: relative;
  width: 0.7rem;
  height: 2rem;
  margin: 0 -0.1rem;
  padding: 0;
  border: none;
  background: none;
}
.ws-split-at::before {
  content: '';
  position: absolute;
  inset: 0.15rem 50%;
  border-left: 1px dashed transparent;
}
.ws-split-at:hover::before {
  border-left-color: var(--lte-accent);
}
.ws-field {
  display: grid;
  gap: 0.25rem;
  color: var(--lte-muted);
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.ws-field input {
  width: 9rem;
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
.ws-field input:focus {
  border-color: var(--lte-accent);
}
.ws-empty {
  grid-column: 2;
  padding: 3rem;
  color: var(--lte-muted);
  text-align: center;
}

@media (max-width: 860px) {
  .ws {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 11rem minmax(0, 1fr);
  }
  .ws-side {
    border-right: none;
    border-bottom: 1px solid var(--lte-line);
  }
  .ws-main {
    padding: 1rem;
  }
  .ws-head {
    flex-wrap: wrap;
  }
  .ws-head-text {
    flex-basis: 100%;
    order: 3;
    font-size: 1.25rem;
  }
}
</style>
