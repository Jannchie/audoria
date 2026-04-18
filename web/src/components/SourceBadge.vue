<script setup lang="ts">
import { computed } from 'vue'
import { getSourceDisplay } from '../utils/source'

const props = withDefaults(defineProps<{
  source: string | null | undefined
  showLabel?: boolean
  size?: 'xs' | 'sm' | 'md'
}>(), {
  showLabel: true,
  size: 'sm',
})

const display = computed(() => getSourceDisplay(props.source))
</script>

<template>
  <span
    class="source-badge"
    :class="[`source-badge--${size}`, { 'source-badge--icon-only': !showLabel }]"
  >
    <span
      class="source-badge__icon"
      :class="display.icon"
    />
    <span
      v-if="showLabel"
      class="source-badge__label"
    >{{ display.label }}</span>
  </span>
</template>

<style scoped>
.source-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.source-badge__icon {
  font-size: 1em;
}

.source-badge__label {
  font-size: 0.75em;
}

.source-badge--xs {
  font-size: 0.75rem;
}

.source-badge--sm {
  font-size: 0.875rem;
}

.source-badge--md {
  font-size: 1rem;
}

.source-badge--icon-only .source-badge__icon {
  font-size: 1.1em;
}
</style>
