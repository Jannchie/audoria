<script setup lang="ts">
import { computed, ref } from 'vue'
import { cueStart } from '../core/index.js'
import { useSession } from '../session.js'
import { formatTimecode } from '../time.js'

// Kept apart from the editor shell: it follows the playhead every frame, and on its own it
// re-renders alone.

const RATES = [0.5, 0.75, 1, 1.25]

const session = useSession()
const { doc, now, playing, duration, rate, t } = session

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
  ? doc.value.cues.flatMap((cue) => {
      const start = cueStart(cue)
      return start === undefined || cue.words.length === 0 ? [] : [start / duration.value * 100]
    })
  : [])
</script>

<template>
  <footer class="tb">
    <button
      type="button"
      class="tb-play"
      :aria-label="playing ? t.pause : t.play"
      @click="session.togglePlay()"
    >
      <svg
        v-if="playing"
        viewBox="0 0 24 24"
      ><path d="M8.5 5h0a2 2 0 012 2V17a2 2 0 01-2 2h0a2 2 0 01-2-2V7a2 2 0 012-2zm7 0h0a2 2 0 012 2V17a2 2 0 01-2 2h0a2 2 0 01-2-2V7a2 2 0 012-2z" /></svg>
      <svg
        v-else
        viewBox="0 0 24 24"
      ><path d="M10.23 6l8.66 5a1.16 1.16 0 010 2l-8.66 5A1.16 1.16 0 018.5 17V7a1.16 1.16 0 011.73-1z" /></svg>
    </button>
    <span class="tb-clock">{{ formatTimecode(now) }}</span>
    <div
      ref="scrub"
      class="tb-scrub"
      @pointerdown="onScrubDown"
      @pointermove="onScrubMove"
    >
      <span
        v-for="(mark, i) in lineMarks"
        :key="i"
        class="tb-mark"
        :style="{ left: `${mark}%` }"
      />
      <span
        class="tb-fill"
        :style="{ width: `${duration ? now / duration * 100 : 0}%` }"
      />
    </div>
    <span class="tb-clock tb-clock--total">{{ formatTimecode(duration) }}</span>
    <div
      class="tb-rates"
      role="group"
      :aria-label="t.rate"
    >
      <button
        v-for="value in RATES"
        :key="value"
        type="button"
        :class="{ 'tb-rate--on': rate === value }"
        @click="session.setRate(value)"
      >
        {{ value }}×
      </button>
    </div>
  </footer>
</template>

<style scoped>
.tb {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--lte-line);
  background: var(--lte-panel);
}
.tb-play {
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
.tb-play:active {
  transform: scale(0.94);
}
.tb-play svg {
  width: 1.15rem;
  height: 1.15rem;
  fill: #fff;
  stroke: #fff;
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.tb-clock {
  min-width: 8.5ch;
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
}
.tb-clock--total {
  min-width: 0;
  color: var(--lte-muted);
  font-size: 0.8125rem;
}
.tb-scrub {
  position: relative;
  flex: 1;
  height: 1.75rem;
  cursor: pointer;
  touch-action: none;
}
.tb-scrub::before {
  content: '';
  position: absolute;
  inset: 50% 0 auto;
  height: 4px;
  margin-top: -2px;
  border-radius: 2px;
  background: var(--lte-line-strong);
}
.tb-fill {
  position: absolute;
  top: 50%;
  left: 0;
  height: 4px;
  margin-top: -2px;
  border-radius: 2px;
  background: var(--lte-accent);
  pointer-events: none;
}
.tb-fill::after {
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
.tb-mark {
  position: absolute;
  top: 0.35rem;
  bottom: 0.35rem;
  width: 1px;
  background: var(--lte-faint);
  pointer-events: none;
}
.tb-rates {
  display: flex;
  overflow: hidden;
  border: 1px solid var(--lte-line-strong);
  border-radius: var(--lte-radius);
}
.tb-rates button {
  padding: 0.3rem 0.5rem;
  border: none;
  background: none;
  color: var(--lte-muted);
  font-size: 0.75rem;
}
.tb-rates button + button {
  border-left: 1px solid var(--lte-line-strong);
}
.tb-rates .tb-rate--on {
  background: var(--lte-raised);
  color: var(--lte-text);
}

@media (max-width: 720px) {
  .tb-clock--total,
  .tb-rates {
    display: none;
  }
}
</style>
