<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  icon: string
  active?: boolean
  disabled?: boolean
  ariaLabel?: string
  tone?: 'primary' | 'ghost'
}>()

const toneClass = computed(() => {
  if (props.tone === 'primary') {
    return props.disabled
      ? 'bg-slate-700 text-white'
      : 'bg-blue-500 text-white hover:bg-blue-600'
  }
  return props.disabled
    ? 'text-slate-500 hover:bg-transparent'
    : (props.active
        ? 'text-blue-400 hover:bg-slate-800'
        : 'text-slate-200 hover:bg-slate-800')
})
</script>

<template>
  <button
    class="px-3 py-2 rounded-md flex transition-colors items-center justify-center"
    :class="toneClass"
    :aria-label="ariaLabel"
    :disabled="disabled"
    type="button"
  >
    <span class="text-lg inline-block" :class="icon" />
    <slot />
  </button>
</template>
