<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useCardParallax } from '../composables/useCardParallax'

const target = ref<HTMLDivElement>()
const parallax = reactive(useCardParallax(target, {
  mouseRollAdjust: i => i,
  mouseTiltAdjust: i => i,
}))

const cardStyle = computed(() => ({
  transition: '.3s ease-out all',
  transform: `rotateX(${parallax.roll * 20}deg) rotateY(${parallax.tilt * 20}deg)`,
  width: '100%',
  height: '100%',
}))
</script>

<template>
  <div class="h-full w-full relative">
    <div
      ref="target"
      class="flex h-full w-full perspective-1000px items-center justify-center"
    >
      <div :style="cardStyle">
        <slot />
      </div>
    </div>
  </div>
</template>
