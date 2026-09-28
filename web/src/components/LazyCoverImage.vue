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

// The thumbhash sits behind the image as a background, so the image simply
// paints over it once decoded. Only a failed load is hidden, to keep the
// placeholder instead of a broken-image icon.
const hasError = ref(false)

watch(() => props.src, () => {
  hasError.value = false
})
</script>

<template>
  <span
    class="lazy-cover-image"
    :style="thumbhashPlaceholderStyle(thumbhash)"
  >
    <img
      v-if="!hasError"
      :src="src"
      :alt="alt"
      :width="width"
      :height="height"
      :loading="loading"
      :decoding="decoding"
      class="lazy-cover-image__img"
      @error="hasError = true"
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
}
</style>
