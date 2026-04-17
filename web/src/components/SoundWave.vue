<script setup lang="ts">
defineProps<{
  playing?: boolean
}>()
</script>

<template>
  <div
    class="flex gap-0.5 h-4 items-end"
    aria-hidden="true"
  >
    <span
      class="rounded-full bg-[var(--accent)] w-0.75"
      :style="{
        animation: playing ? 'wave-bar-1 0.6s ease-in-out infinite' : 'none',
        height: playing ? undefined : '4px',
      }"
    />
    <span
      class="rounded-full bg-[var(--accent)] w-0.75"
      :style="{
        animation: playing ? 'wave-bar-2 0.6s ease-in-out 0.15s infinite' : 'none',
        height: playing ? undefined : '6px',
      }"
    />
    <span
      class="rounded-full bg-[var(--accent)] w-0.75"
      :style="{
        animation: playing ? 'wave-bar-3 0.6s ease-in-out 0.3s infinite' : 'none',
        height: playing ? undefined : '3px',
      }"
    />
  </div>
</template>
