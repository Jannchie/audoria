<script setup lang="ts">
import type { LaneBlock } from './WaveformLane.vue'
import { cueText } from '@audoria/lyrics-core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearTiming, incompleteLines, isCreditLine, mergeWithNext, nextWord, nudgeWord, setCueText, setLineBegin, shiftCue, splitWord, stampLine, stampWordEnd, stampWordStart, toWholeLine, wordAt } from '../core/index.js'
import { useSession } from '../session.js'
import { formatTimecode, parseTimecode } from '../time.js'
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
const wordMode = computed(() => session.isWordMode(cueIndex.value))

const todo = computed(() => new Set(incompleteLines(doc.value)))
const visibleLines = computed(() => doc.value.cues.flatMap((item, index) => {
  if (item.words.length === 0) {
    return []
  }
  const status = session.statusOf(index)
  const show = filter.value === 'all'
    || (filter.value === 'word' && (status === 'word' || status === 'partial'))
    || (filter.value === 'line' && status === 'line')
    || (filter.value === 'todo' && todo.value.has(index))
  return show ? [{ index, cue: item, status }] : []
}))

function selectLine(index: number): void {
  cursor.value = { cue: index, word: 0 }
}

function selectWord(index: number): void {
  cursor.value = { cue: cueIndex.value, word: index }
}

function nextLineBegin(index: number): number | undefined {
  for (let i = index + 1; i < doc.value.cues.length; i++) {
    const begin = doc.value.cues[i].words[0]?.begin ?? doc.value.cues[i].begin
    if (begin !== undefined) {
      return begin
    }
  }
  return undefined
}

// ── Lane window: the selected line with some air around it, zoomable ──

const fitWindow = computed(() => {
  const line = cue.value
  if (!line) {
    return { start: 0, span: 6000 }
  }
  const times = wordMode.value
    ? line.words.flatMap(item => [item.begin, item.end]).filter((time): time is number => time !== undefined)
    : []
  const lineEnd = line.end ?? nextLineBegin(cueIndex.value)
  const low = times.length > 0 ? Math.min(...times) : line.begin ?? now.value
  const high = Math.max(times.length > 0 ? Math.max(...times) : lineEnd ?? low + 3000, low + 2500)
  const pad = (high - low) * 0.12 + 400
  const span = (high - low + pad * 2) / zoom.value
  return { start: Math.max(0, (low + high) / 2 - span / 2), span }
})

// Held still while a block is dragged, so the pointer keeps its place on the time axis.
const heldWindow = ref<{ start: number, span: number } | null>(null)
const window_ = computed(() => heldWindow.value ?? fitWindow.value)

function onDragging(active: boolean): void {
  heldWindow.value = active ? { ...fitWindow.value } : null
}

const blocks = computed<LaneBlock[]>(() => {
  const line = cue.value
  if (!line) {
    return []
  }
  if (!wordMode.value) {
    return line.begin === undefined
      ? []
      : [{ key: -1, label: cueText(line), begin: line.begin, end: line.end ?? nextLineBegin(cueIndex.value), kind: 'line', selected: true }]
  }
  return line.words.flatMap((item, index) => item.begin === undefined
    ? []
    : [{ key: index, label: item.text.trim() || '␣', begin: item.begin, end: item.end, kind: 'word' as const, selected: index === cursor.value.word }])
})

function onDrag(key: number, edge: 'begin' | 'end' | 'both', deltaMs: number): void {
  const group = `drag:${cueIndex.value}:${key}:${edge}`
  if (key < 0) {
    if (edge !== 'end') {
      session.apply(shiftCue(doc.value, cueIndex.value, deltaMs), group)
    }
    return
  }
  session.apply(nudgeWord(doc.value, { cue: cueIndex.value, word: key }, edge, deltaMs), group)
}

function onSelectBlock(key: number): void {
  if (key >= 0) {
    cursor.value = { cue: cueIndex.value, word: key }
  }
}

// ── Editing ──

function toggleMode(): void {
  const line = cue.value
  if (!line) {
    return
  }
  if (wordMode.value) {
    session.wordLines.delete(line.id)
    if (line.words.some(item => item.begin !== undefined)) {
      session.apply(toWholeLine(doc.value, cueIndex.value))
    }
  }
  else {
    session.wordLines.add(line.id)
    cursor.value = { cue: cueIndex.value, word: 0 }
  }
}

function stamp(): void {
  if (!cue.value || cue.value.words.length === 0) {
    return
  }
  if (!wordMode.value) {
    session.apply(stampLine(doc.value, cueIndex.value, session.currentMs()))
    session.markStamp(cueIndex.value)
    const next = doc.value.cues.findIndex((item, i) => i > cueIndex.value && item.words.length > 0)
    if (next !== -1) {
      selectLine(next)
    }
    return
  }
  const ref_ = cursor.value
  const result = stampWordStart(doc.value, ref_, session.currentMs())
  session.apply(result.doc)
  session.markStamp(ref_.cue, ref_.word)
  // Carry on into the next line only when it is being timed word by word too.
  if (result.next && (result.next.cue === ref_.cue || session.isWordMode(result.next.cue))) {
    cursor.value = result.next
  }
}

function stampEnd(): void {
  const last = session.lastStamp.value
  const target = last && last.word !== undefined && last.cue === cueIndex.value
    ? { cue: last.cue, word: last.word }
    : { cue: cueIndex.value, word: Math.max(0, cursor.value.word - 1) }
  session.apply(stampWordEnd(doc.value, target, session.currentMs()))
}

function nudge(edge: 'begin' | 'end', deltaMs: number): void {
  if (!wordMode.value) {
    if (edge === 'begin' && cue.value?.begin !== undefined) {
      session.apply(shiftCue(doc.value, cueIndex.value, deltaMs), `nudge-line:${cueIndex.value}`)
    }
    return
  }
  session.apply(nudgeWord(doc.value, cursor.value, edge, deltaMs), `nudge:${cursor.value.cue}:${cursor.value.word}:${edge}`)
}

function replayLine(): void {
  const begin = cue.value?.words.find(item => item.begin !== undefined)?.begin ?? cue.value?.begin
  if (begin !== undefined) {
    session.seek(begin - 600)
  }
  session.play()
}

function setEdge(edge: 'begin' | 'end', text: string): void {
  const time = parseTimecode(text)
  const current = word.value?.[edge]
  if (time === undefined || !word.value) {
    return
  }
  if (current === undefined) {
    session.apply(edge === 'begin' ? stampWordStart(doc.value, cursor.value, time).doc : stampWordEnd(doc.value, cursor.value, time))
  }
  else {
    session.apply(nudgeWord(doc.value, cursor.value, edge, time - current))
  }
}

function setLineStart(text: string): void {
  const time = parseTimecode(text)
  if (time !== undefined) {
    session.apply(setLineBegin(doc.value, cueIndex.value, time))
  }
}

function editText(text: string): void {
  if (cue.value && text !== cueText(cue.value)) {
    session.apply(setCueText(doc.value, cueIndex.value, text))
    cursor.value = { cue: cueIndex.value, word: 0 }
  }
}

function moveLine(direction: 1 | -1): void {
  const list = visibleLines.value
  const position = list.findIndex(item => item.index === cueIndex.value)
  const next = list[position + direction] ?? (position < 0 ? list[0] : undefined)
  if (next) {
    selectLine(next.index)
  }
}

function moveWord(direction: 1 | -1): void {
  const count = cue.value?.words.length ?? 0
  const next = cursor.value.word + direction
  if (next >= 0 && next < count) {
    cursor.value = { cue: cueIndex.value, word: next }
  }
}

function onKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }
  const key = event.key.toLowerCase()
  const step = event.shiftKey ? 100 : 10
  const actions: Record<string, () => void> = {
    ' ': () => session.isPlaying() ? stamp() : session.play(),
    'j': () => session.isPlaying() ? stamp() : session.play(),
    'k': stampEnd,
    'l': toggleMode,
    'r': replayLine,
    'm': () => session.apply(mergeWithNext(doc.value, cursor.value)),
    'backspace': () => session.apply(clearTiming(doc.value, cursor.value)),
    'delete': () => session.apply(clearTiming(doc.value, cursor.value)),
    'a': () => nudge('begin', -step),
    'd': () => nudge('begin', step),
    'z': () => nudge('end', -step),
    'c': () => nudge('end', step),
    'arrowup': () => moveLine(-1),
    'arrowdown': () => moveLine(1),
  }
  if (!event.shiftKey) {
    actions.arrowleft = () => moveWord(-1)
    actions.arrowright = () => moveWord(1)
  }
  const action = actions[key]
  action?.()
  return Boolean(action)
}

const isFlashing = (cueAt: number, wordAt_: number): boolean => session.lastStamp.value?.cue === cueAt && session.lastStamp.value.word === wordAt_

watch(cueIndex, async () => {
  zoom.value = 1
  await nextTick()
  listEl.value?.querySelector('.ws-item--on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

onMounted(() => {
  session.keyHandler.value = onKey
  session.loadPeaks()
  if (!cue.value || cue.value.words.length === 0) {
    const first = nextWord(doc.value, { cue: -1, word: 0 })
    if (first) {
      selectLine(first.cue)
    }
  }
})
onBeforeUnmount(() => {
  if (session.keyHandler.value === onKey) {
    session.keyHandler.value = null
  }
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
            @click="selectLine(item.index)"
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
        <div
          class="ws-mode"
          role="group"
          title="L"
        >
          <button
            type="button"
            :class="{ 'ws-mode--on': !wordMode }"
            @click="wordMode && toggleMode()"
          >
            {{ t.modeLine }}
          </button>
          <button
            type="button"
            :class="{ 'ws-mode--on': wordMode }"
            @click="!wordMode && toggleMode()"
          >
            {{ t.modeWord }}
          </button>
        </div>
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
          :start="window_.start"
          :span="window_.span"
          :blocks="blocks"
          @select="onSelectBlock"
          @drag="onDrag"
          @dragging="onDragging"
          @seek="session.seek"
        />
        <div class="ws-zoom">
          <button
            type="button"
            :title="t.zoomOut"
            @click="zoom = Math.max(0.25, zoom / 1.5)"
          >
            −
          </button>
          <button
            type="button"
            :title="t.zoomIn"
            @click="zoom = Math.min(8, zoom * 1.5)"
          >
            +
          </button>
        </div>
      </div>

      <template v-if="wordMode">
        <p class="ws-hint">
          {{ t.modeWordHint }}
        </p>
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
              }"
              @click="selectWord(w)"
              @dblclick="item.begin !== undefined && session.seek(item.begin)"
            >
              <span
                v-if="isFlashing(cueIndex, w)"
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
          <label
            v-for="edge in (['begin', 'end'] as const)"
            :key="edge"
            class="ws-field"
          >
            <span>{{ edge === 'begin' ? t.begin : t.end }}</span>
            <input
              :value="word[edge] === undefined ? '' : formatTimecode(word[edge])"
              :placeholder="t.untimed"
              spellcheck="false"
              @change="setEdge(edge, ($event.target as HTMLInputElement).value)"
            >
          </label>
          <button
            type="button"
            class="ws-ghost"
            :disabled="word.begin === undefined"
            @click="session.apply(clearTiming(doc, cursor))"
          >
            {{ t.clear }}
          </button>
        </div>
      </template>

      <div
        v-else
        class="ws-detail ws-detail--line"
      >
        <p class="ws-hint">
          {{ t.modeLineHint }}
        </p>
        <label class="ws-field">
          <span>{{ t.begin }}</span>
          <input
            :value="cue.begin === undefined ? '' : formatTimecode(cue.begin)"
            :placeholder="t.untimed"
            spellcheck="false"
            @change="setLineStart(($event.target as HTMLInputElement).value)"
          >
        </label>
      </div>
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
.ws-mode {
  display: flex;
  overflow: hidden;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
}
.ws-mode button {
  padding: 0.35rem 0.8rem;
  border: none;
  background: none;
  color: var(--lte-muted);
  font-family: var(--lte-sans) !important;
}
.ws-mode button + button {
  border-left: 1px solid var(--lte-line-strong);
}
.ws-mode .ws-mode--on:first-child {
  background: var(--lte-whole-soft);
  color: var(--lte-whole);
}
.ws-mode .ws-mode--on:last-child {
  background: var(--lte-word-soft);
  color: var(--lte-word);
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
}
.ws-zoom {
  position: absolute;
  top: 0.3rem;
  right: 0.4rem;
  display: flex;
  gap: 2px;
  z-index: 3;
}
.ws-zoom button {
  width: 1.4rem;
  height: 1.1rem;
  padding: 0;
  border: 1px solid var(--lte-line-strong);
  border-radius: 3px;
  background: var(--lte-panel);
  line-height: 1;
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
.ws-detail--line {
  flex-direction: column;
  align-items: start;
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
