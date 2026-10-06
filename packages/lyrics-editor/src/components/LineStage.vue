<script setup lang="ts">
import { cueText } from '@audoria/lyrics-core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { incompleteLines, isCreditLine, isSung, lineAt, nextLine } from '../core/index.js'
import { useSession, useStageKeys } from '../session.js'
import { formatTimecode } from '../time.js'

const session = useSession()
const { doc, now, playing, t, cursor } = session

const target = computed(() => cursor.value.cue)
const listEl = ref<HTMLElement | null>(null)

const playingIndex = computed(() => lineAt(doc.value, now.value))
const remaining = computed(() => incompleteLines(doc.value).length)

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

function onKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }
  const step = event.shiftKey ? 250 : 50
  switch (event.key.toLowerCase()) {
    case ' ':
    case 'j': {
      if (session.isPlaying()) {
        stamp()
      }
      else {
        session.play()
      }
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
  listEl.value?.querySelector('.ls-line--target')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

onMounted(() => {
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
  void nextTick(() => listEl.value?.querySelector('.ls-line--target')?.scrollIntoView({ block: 'center' }))
})
</script>

<template>
  <div class="ls">
    <div class="ls-hint">
      <template v-if="remaining === 0 && doc.cues.length > 0">
        <span class="ls-done">✓ {{ t.lineAllDone }}</span>
        <button
          type="button"
          class="ls-link"
          @click="session.stage.value = 'word'"
        >
          {{ t.lineToWords }} →
        </button>
      </template>
      <template v-else>
        <kbd>Space</kbd>
        <span>{{ playing ? t.lineTapHint : t.lineStartHint }}</span>
        <span class="ls-hint-spacer" />
        <span class="ls-count">{{ remaining }} {{ t.lines }}</span>
      </template>
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
          <span class="ls-time">{{ cue.begin === undefined ? '—' : formatTimecode(cue.begin) }}</span>
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
        @pointerdown.prevent="session.isPlaying() ? stamp() : session.play()"
      >
        {{ playing ? t.lineTap : t.play }}
        <kbd>Space</kbd>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ls {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
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
.ls-count {
  font-family: var(--lte-mono);
  font-size: 0.75rem;
}
.ls-done {
  color: var(--lte-word);
}
.ls-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--lte-accent) !important;
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
  align-items: baseline;
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
.ls-line--timed .ls-time {
  color: var(--lte-whole);
}

.ls-text {
  position: relative;
  color: var(--lte-muted);
  font-family: var(--lte-sans);
  font-size: 1.2rem;
  line-height: 1.5;
  transform-origin: left center;
  transition: color 200ms ease, font-size 200ms ease;
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
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: 0.01em;
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
  .ls-line--target .ls-text {
    font-size: 1.45rem;
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
