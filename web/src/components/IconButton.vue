<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  icon: string
  active?: boolean
  disabled?: boolean
  ariaLabel?: string
  tone?: 'primary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}>()

const sizeClass = computed(() => {
  if (props.size === 'sm') {
    return 'h-10 w-10 text-lg'
  }
  if (props.size === 'lg') {
    return 'h-12 w-12 text-xl'
  }
  return 'h-11 w-11 text-lg'
})

const toneClass = computed(() => {
  if (props.tone === 'primary') {
    return props.disabled
      ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] cursor-not-allowed'
      : 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
  }
  if (props.disabled) {
    return 'text-[var(--text-tertiary)] cursor-not-allowed'
  }
  if (props.active) {
    return 'text-[var(--accent)]'
  }
  return 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
})
</script>

<template>
  <button
    class="rounded-full flex transition-colors items-center justify-center"
    :class="[toneClass, sizeClass]"
    :aria-label="ariaLabel"
    :disabled="disabled"
    type="button"
  >
    <span
      class="inline-block"
      :class="icon"
    />
    <slot />
  </button>
</template>
