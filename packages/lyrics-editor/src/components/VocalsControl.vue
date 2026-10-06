<script setup lang="ts">
import { computed } from 'vue'
import { useSession } from '../session.js'

const session = useSession()
const { vocalsState, vocalsProgress, showVocals, t } = session

const label = computed(() => {
  const progress = vocalsProgress.value
  switch (vocalsState.value) {
    case 'loading': {
      return t.value.vocalsLoading
    }
    case 'separating': {
      return progress
        ? `${progress.phase === 'model' ? t.value.vocalsDownloading : t.value.vocalsSeparating} ${Math.round(progress.fraction * 100)}%`
        : t.value.vocalsSeparating
    }
    case 'ready': {
      return t.value.vocalsReady
    }
    case 'failed': {
      return t.value.vocalsFailed
    }
    default: {
      return t.value.vocalsSeparate
    }
  }
})

const busy = computed(() => vocalsState.value === 'loading' || vocalsState.value === 'separating')

function onClick(): void {
  if (vocalsState.value === 'ready') {
    showVocals.value = !showVocals.value
  }
  else {
    session.separateVocals()
  }
}
</script>

<template>
  <button
    v-if="vocalsState !== 'unavailable'"
    type="button"
    class="vc"
    :class="{
      'vc--on': vocalsState === 'ready' && showVocals,
      'vc--busy': busy,
      'vc--failed': vocalsState === 'failed',
    }"
    :disabled="busy"
    :title="vocalsState === 'ready' ? t.vocalsToggleHint : (session.vocalsError.value || t.vocalsSeparateHint)"
    :aria-pressed="vocalsState === 'ready' ? showVocals : undefined"
    @click="onClick"
  >
    <span
      class="vc-dot"
      :style="vocalsProgress ? { '--p': vocalsProgress.fraction } : undefined"
    />
    {{ label }}
  </button>
</template>

<style scoped>
.vc {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  height: 2rem;
  padding: 0 0.75rem;
  border: 1px solid var(--lte-line-strong);
  border-radius: 999px;
  background: none;
  color: var(--lte-muted);
  font-family: var(--lte-sans) !important;
  font-size: 0.8125rem !important;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
.vc:hover:not(:disabled) {
  background: var(--lte-hover);
  color: var(--lte-text);
}
.vc:disabled {
  cursor: progress;
}
.vc-dot {
  width: 0.6rem;
  height: 0.6rem;
  border: 1.5px solid currentColor;
  border-radius: 50%;
}
.vc--on {
  border-color: rgba(127, 209, 185, 0.5);
  color: var(--lte-word);
}
.vc--on .vc-dot {
  border-color: var(--lte-word);
  background: var(--lte-word);
}
/* While busy the dot fills up as a progress ring. */
.vc--busy .vc-dot {
  border-color: var(--lte-line-strong);
  background: conic-gradient(var(--lte-word) calc(var(--p, 0) * 360deg), transparent 0);
}
.vc--failed {
  color: var(--lte-accent);
}
</style>
