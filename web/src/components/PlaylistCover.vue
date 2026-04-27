<script setup lang="ts">
import { computed } from 'vue'
import { resolveApiUrl } from '../composables/useMusic'
import LazyCoverImage from './LazyCoverImage.vue'

const props = withDefaults(defineProps<{
  thumbhashes?: Array<string | null>
  urls: string[]
  size?: 'sm' | 'md' | 'lg'
  rounded?: boolean
}>(), {
  size: 'md',
  rounded: true,
})

const resolved = computed(() =>
  (props.urls ?? [])
    .map((url, index) => ({
      thumbhash: props.thumbhashes?.[index] ?? null,
      url,
    }))
    .filter(item => typeof item.url === 'string' && item.url.length > 0)
    .slice(0, 4)
    .map(item => ({
      ...item,
      url: resolveApiUrl(item.url),
    })),
)

const layout = computed<'empty' | 'single' | 'grid'>(() => {
  const n = resolved.value.length
  if (n === 0) {
    return 'empty'
  }
  if (n === 1) {
    return 'single'
  }
  return 'grid'
})

// When we only have 2 or 3 covers, repeat them to fill the 4-cell grid
const gridCovers = computed(() => {
  const covers = resolved.value
  const n = covers.length
  if (n >= 4) {
    return covers.slice(0, 4)
  }
  if (n === 3) {
    return [covers[0], covers[1], covers[2], covers[0]]
  }
  if (n === 2) {
    return [covers[0], covers[1], covers[1], covers[0]]
  }
  return covers
})
</script>

<template>
  <div
    class="playlist-cover"
    :class="[`playlist-cover--${size}`, { 'playlist-cover--rounded': rounded }]"
  >
    <template v-if="layout === 'single'">
      <LazyCoverImage
        :src="resolved[0].url"
        :thumbhash="resolved[0].thumbhash"
        alt=""
        class="playlist-cover-img"
      />
    </template>
    <template v-else-if="layout === 'grid'">
      <div class="playlist-cover-grid">
        <LazyCoverImage
          v-for="(cover, index) in gridCovers"
          :key="`${index}-${cover.url}`"
          :src="cover.url"
          :thumbhash="cover.thumbhash"
          alt=""
          class="playlist-cover-tile"
        />
      </div>
    </template>
    <template v-else>
      <span
        class="i-tabler-playlist playlist-cover-placeholder"
        aria-hidden="true"
      />
    </template>
  </div>
</template>

<style scoped>
.playlist-cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--bg-elevated, var(--bg-surface));
  color: var(--text-tertiary);
  aspect-ratio: 1 / 1;
  flex-shrink: 0;
}

.playlist-cover--rounded {
  border-radius: 0.75rem;
}

.playlist-cover--sm {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
}

.playlist-cover--md {
  width: 4rem;
  height: 4rem;
}

.playlist-cover--lg {
  width: min(14rem, 60vw);
  height: min(14rem, 60vw);
  border-radius: 1rem;
}

.playlist-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.playlist-cover-grid {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  background: var(--bg-base);
}

.playlist-cover-tile {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.playlist-cover-placeholder {
  font-size: 40%;
}

.playlist-cover--sm .playlist-cover-placeholder {
  font-size: 1rem;
}

.playlist-cover--md .playlist-cover-placeholder {
  font-size: 1.75rem;
}

.playlist-cover--lg .playlist-cover-placeholder {
  font-size: 3.5rem;
}
</style>
