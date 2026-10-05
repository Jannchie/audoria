<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSession } from '../session.js'
import { formatTimecode } from '../time.js'

export interface LaneBlock {
  key: number
  label: string
  begin: number
  /** Undefined while the block's end is still open. */
  end?: number
  kind: 'word' | 'line'
  selected: boolean
}

const props = defineProps<{
  /** Visible window, in ms. */
  start: number
  span: number
  blocks: LaneBlock[]
}>()

const emit = defineEmits<{
  select: [key: number]
  /** A drag step: the block's edge (or the whole block) moved by `deltaMs` since the last step. */
  drag: [key: number, edge: 'begin' | 'end' | 'both', deltaMs: number]
  seek: [ms: number]
  /** A drag began or ended; the window should hold still meanwhile. */
  dragging: [active: boolean]
}>()

const session = useSession()
const { now, peaks, peaksState, t } = session

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)

const pct = (ms: number): number => (ms - props.start) / props.span * 100

const ticks = computed(() => {
  const step = props.span > 12_000 ? 2000 : props.span > 5000 ? 1000 : 500
  const first = Math.ceil(props.start / step) * step
  return Array.from({ length: Math.max(0, Math.floor((props.start + props.span - first) / step) + 1) }, (_, i) => first + i * step)
})

const playhead = computed(() => pct(now.value))

function draw(): void {
  const element = canvas.value
  const data = peaks.value
  if (!element) {
    return
  }
  const ratio = window.devicePixelRatio || 1
  const cssWidth = element.clientWidth
  const cssHeight = element.clientHeight
  const context = element.getContext('2d')
  if (!context) {
    return
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, cssWidth, cssHeight)
  const middle = cssHeight / 2
  context.fillStyle = 'rgba(255, 255, 255, 0.08)'
  context.fillRect(0, middle, cssWidth, 1)
  if (!data) {
    return
  }
  context.fillStyle = 'rgba(214, 218, 230, 0.42)'
  const bucketsPerPixel = props.span / 1000 * data.rate / cssWidth
  for (let x = 0; x < cssWidth; x++) {
    const from = Math.floor((props.start / 1000) * data.rate + x * bucketsPerPixel)
    const to = Math.max(from + 1, Math.floor((props.start / 1000) * data.rate + (x + 1) * bucketsPerPixel))
    let low = 0
    let high = 0
    for (let b = Math.max(0, from); b < Math.min(data.min.length, to); b++) {
      low = Math.min(low, data.min[b])
      high = Math.max(high, data.max[b])
    }
    const top = middle - high * middle * 0.92
    const bottom = middle - low * middle * 0.92
    context.fillRect(x, top, 1, Math.max(1, bottom - top))
  }
}

let observer: ResizeObserver | undefined
onMounted(() => {
  // Resizing the backing store clears it, so it happens only when the element's size changes.
  observer = new ResizeObserver(() => {
    const element = canvas.value
    if (element) {
      const ratio = window.devicePixelRatio || 1
      element.width = Math.round(element.clientWidth * ratio)
      element.height = Math.round(element.clientHeight * ratio)
    }
    draw()
  })
  if (root.value) {
    observer.observe(root.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => [props.start, props.span, peaks.value], draw)

// ── Dragging block edges, or whole blocks ──

let drag: { key: number, edge: 'begin' | 'end' | 'both', lastX: number, moved: boolean } | null = null

function startDrag(event: PointerEvent, key: number, edge: 'begin' | 'end' | 'both'): void {
  event.stopPropagation()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag = { key, edge, lastX: event.clientX, moved: false }
  emit('select', key)
  emit('dragging', true)
}

function moveDrag(event: PointerEvent): void {
  if (!drag || !root.value) {
    return
  }
  const deltaMs = Math.round((event.clientX - drag.lastX) / root.value.clientWidth * props.span)
  if (deltaMs !== 0) {
    drag.lastX = event.clientX
    drag.moved = true
    emit('drag', drag.key, drag.edge, deltaMs)
  }
}

function endDrag(): void {
  if (drag) {
    drag = null
    emit('dragging', false)
  }
}

function onLaneClick(event: MouseEvent): void {
  const rect = root.value!.getBoundingClientRect()
  emit('seek', props.start + (event.clientX - rect.left) / rect.width * props.span)
}
</script>

<template>
  <div
    ref="root"
    class="wl"
    @click="onLaneClick"
  >
    <div class="wl-ruler">
      <span
        v-for="tick in ticks"
        :key="tick"
        class="wl-tick"
        :style="{ left: `${pct(tick)}%` }"
      >{{ formatTimecode(tick).replace(/\.\d+$/, '') }}<small v-if="tick % 1000">.5</small></span>
    </div>
    <canvas
      ref="canvas"
      class="wl-wave"
    />
    <p
      v-if="peaksState === 'loading' || peaksState === 'failed'"
      class="wl-state"
    >
      {{ peaksState === 'loading' ? t.waveLoading : t.waveFailed }}
    </p>
    <div class="wl-blocks">
      <div
        v-for="block in blocks"
        :key="block.key"
        class="wl-block"
        :class="[`wl-block--${block.kind}`, { 'wl-block--selected': block.selected, 'wl-block--open': block.end === undefined }]"
        :style="{
          left: `${pct(block.begin)}%`,
          width: `${Math.max(0.6, ((block.end ?? block.begin + 300) - block.begin) / span * 100)}%`,
        }"
        @pointerdown="startDrag($event, block.key, 'both')"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @click.stop
      >
        <span
          class="wl-edge wl-edge--begin"
          @pointerdown="startDrag($event, block.key, 'begin')"
          @pointermove="moveDrag"
          @pointerup="endDrag"
        />
        <span class="wl-label">{{ block.label }}</span>
        <span
          v-if="block.end !== undefined"
          class="wl-edge wl-edge--end"
          @pointerdown="startDrag($event, block.key, 'end')"
          @pointermove="moveDrag"
          @pointerup="endDrag"
        />
      </div>
    </div>
    <span
      class="wl-playhead"
      :style="{ left: `${playhead}%`, opacity: playhead >= 0 && playhead <= 100 ? 1 : 0 }"
    />
  </div>
</template>

<style scoped>
.wl {
  position: relative;
  height: 11rem;
  overflow: hidden;
  border: 1px solid var(--lte-line);
  border-radius: calc(var(--lte-radius) + 2px);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent 40%),
    var(--lte-bg);
  cursor: crosshair;
  user-select: none;
}
.wl-ruler {
  position: absolute;
  inset: 0 0 auto;
  height: 1.5rem;
  border-bottom: 1px solid var(--lte-line);
}
.wl-tick {
  position: absolute;
  top: 0.3rem;
  padding-left: 0.3rem;
  border-left: 1px solid var(--lte-line-strong);
  color: var(--lte-faint);
  font-size: 0.625rem;
  line-height: 1;
  white-space: nowrap;
}
.wl-tick small {
  font-size: inherit;
}
.wl-wave {
  position: absolute;
  top: 1.5rem;
  left: 0;
  width: 100%;
  height: 5.5rem;
}
.wl-state {
  position: absolute;
  top: 3.6rem;
  left: 0;
  right: 0;
  margin: 0;
  color: var(--lte-muted);
  font-size: 0.75rem;
  text-align: center;
}
.wl-blocks {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0.6rem;
  height: 2.6rem;
}
.wl-block {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  min-width: 4px;
  border: 1px solid;
  border-radius: 4px;
  cursor: grab;
  touch-action: none;
}
.wl-block:active {
  cursor: grabbing;
}
.wl-block--word {
  border-color: rgba(127, 209, 185, 0.55);
  background: var(--lte-word-soft);
}
.wl-block--line {
  border-color: rgba(232, 184, 107, 0.55);
  background: var(--lte-whole-soft);
}
.wl-block--open {
  border-right-style: dashed;
}
.wl-block--selected {
  z-index: 1;
  border-color: var(--lte-accent);
  background: var(--lte-accent-soft);
  box-shadow: 0 0 0 1px var(--lte-accent), 0 4px 18px -6px var(--lte-accent);
}
.wl-label {
  flex: 1;
  overflow: hidden;
  padding: 0 0.35rem;
  font-family: var(--lte-sans);
  font-size: 1rem;
  white-space: nowrap;
  pointer-events: none;
}
.wl-edge {
  position: absolute;
  top: -1px;
  bottom: -1px;
  width: 9px;
  cursor: ew-resize;
}
.wl-edge::after {
  content: '';
  position: absolute;
  top: 25%;
  bottom: 25%;
  left: 3px;
  width: 3px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0;
  transition: opacity 120ms ease;
}
.wl-block:hover .wl-edge::after,
.wl-block--selected .wl-edge::after {
  opacity: 0.7;
}
.wl-edge--begin {
  left: -5px;
}
.wl-edge--end {
  right: -5px;
}
.wl-playhead {
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
</style>
