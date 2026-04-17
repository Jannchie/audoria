<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue'
import { computed, ref, watchEffect } from 'vue'

const props = defineProps<{
  lyric: string
  ratio: number | null
  timeLabel: string
  trackElement: HTMLElement | null
  visible: boolean
}>()

const floating = ref<HTMLElement | null>(null)
const reference = ref<{
  getBoundingClientRect: () => DOMRect
}>()

const { floatingStyles, update } = useFloating(reference, floating, {
  middleware: [
    offset(12),
    flip(),
    shift({ padding: 8 }),
  ],
  placement: 'top',
  strategy: 'fixed',
  whileElementsMounted: autoUpdate,
})

const clampedRatio = computed(() => {
  if (props.ratio === null) {
    return null
  }
  return Math.min(1, Math.max(0, props.ratio))
})

watchEffect(() => {
  if (!props.trackElement || clampedRatio.value === null) {
    reference.value = undefined
    return
  }

  const element = props.trackElement
  const ratio = clampedRatio.value
  const virtualReference = {
    getBoundingClientRect() {
      const rect = element.getBoundingClientRect()
      const x = rect.left + rect.width * ratio
      const y = rect.top + rect.height / 2
      return DOMRect.fromRect({
        x,
        y,
        width: 0,
        height: 0,
      })
    },
  }

  reference.value = virtualReference
  if (props.visible) {
    update()
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && ratio !== null"
      ref="floating"
      class="progress-tooltip"
      :style="floatingStyles"
    >
      <div class="progress-tooltip-time">
        {{ timeLabel }}
      </div>
      <div class="progress-tooltip-lyric">
        {{ lyric }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.progress-tooltip {
  pointer-events: none;
  z-index: 80;
  max-width: min(20rem, calc(100vw - 1rem));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.75rem;
  padding: 0.55rem 0.7rem;
  background: rgba(14, 14, 16, 0.94);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.28);
}

.progress-tooltip-time {
  font-size: 0.6875rem;
  line-height: 1;
  color: rgba(255, 255, 255, 0.56);
  font-variant-numeric: tabular-nums;
}

.progress-tooltip-lyric {
  margin-top: 0.35rem;
  font-size: 0.8125rem;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
