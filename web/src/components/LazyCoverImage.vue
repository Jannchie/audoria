<script setup lang="ts">
import { ref, watch } from 'vue'
import { thumbhashPlaceholderStyle } from '../utils/thumbhash'

const props = withDefaults(defineProps<{
  alt?: string
  decoding?: 'async' | 'auto' | 'sync'
  height?: number | string
  loading?: 'eager' | 'lazy'
  src: string
  thumbhash?: string | null
  width?: number | string
}>(), {
  alt: '',
  decoding: 'async',
  loading: 'lazy',
})

const isLoaded = ref(false)

watch(() => props.src, () => {
  isLoaded.value = false
})
</script>

<template>
  <span
    class="lazy-cover-image"
    :style="thumbhashPlaceholderStyle(thumbhash)"
  >
    <img
      :src="src"
      :alt="alt"
      :width="width"
      :height="height"
      :loading="loading"
      :decoding="decoding"
      class="lazy-cover-image__img"
      :class="{ 'lazy-cover-image__img--loaded': isLoaded }"
      @load="isLoaded = true"
      @error="isLoaded = false"
    >
  </span>
</template>

<style scoped>
.lazy-cover-image {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--bg-elevated, var(--bg-surface));
  background-position: center;
  background-size: cover;
}

.lazy-cover-image__img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  filter: blur(10px);
  transform: scale(1.025);
  transition:
    opacity 220ms ease,
    filter 360ms ease,
    transform 360ms ease;
}

.lazy-cover-image__img--loaded {
  opacity: 1;
  filter: blur(0);
  transform: scale(1);
}
</style>
