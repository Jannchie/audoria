<script setup lang="ts">
import type { ListeningStats } from '../api/types.gen'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatListenedTime } from '../utils/listeningFormat'

const props = defineProps<{
  daily: ListeningStats['daily']
}>()

const { t, locale } = useI18n()
const hoveredIndex = ref<number | null>(null)

const maxSeconds = computed(() => Math.max(1, ...props.daily.map(day => day.listenedSeconds)))

function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  // `date` is a local calendar day; format it as UTC so the day does not shift.
  return new Intl.DateTimeFormat(locale.value, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

const bars = computed(() => props.daily.map(day => ({
  ...day,
  heightPercent: day.listenedSeconds > 0 ? Math.max(2, (day.listenedSeconds / maxSeconds.value) * 100) : 0,
  label: `${formatDate(day.date, { month: 'short', day: 'numeric', weekday: 'short' })} · ${formatListenedTime(day.listenedSeconds)} · ${t('stats.track.plays', { n: day.playCount }, day.playCount)}`,
})))

const hovered = computed(() => hoveredIndex.value === null ? null : bars.value[hoveredIndex.value] ?? null)

const axisLabels = computed(() => {
  const days = props.daily
  if (days.length === 0) {
    return []
  }
  const first = days[0].date
  const last = days.at(-1)!.date
  return [formatDate(first, { month: 'short', day: 'numeric' }), formatDate(last, { month: 'short', day: 'numeric' })]
})
</script>

<template>
  <figure class="history">
    <div class="history-readout">
      <template v-if="hovered">
        {{ hovered.label }}
      </template>
      <template v-else>
        {{ t('stats.history.hint') }}
      </template>
    </div>
    <div
      class="history-plot"
      role="img"
      :aria-label="t('stats.history.title')"
      @pointerleave="hoveredIndex = null"
    >
      <div
        v-for="(bar, index) in bars"
        :key="bar.date"
        class="history-slot"
        :class="{ 'history-slot--active': hoveredIndex === index }"
        :title="bar.label"
        @pointerenter="hoveredIndex = index"
      >
        <span
          class="history-bar"
          :style="{ height: `${bar.heightPercent}%` }"
        />
      </div>
    </div>
    <figcaption class="history-axis">
      <span>{{ axisLabels[0] }}</span>
      <span>{{ axisLabels[1] }}</span>
    </figcaption>
    <table class="sr-only">
      <caption>{{ t('stats.history.title') }}</caption>
      <tbody>
        <tr
          v-for="bar in bars"
          :key="bar.date"
        >
          <td>{{ bar.label }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
.history {
  display: grid;
  gap: 0.5rem;
  margin: 0;
}

.history-readout {
  min-height: 1.25rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.history-plot {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 160px;
  border-bottom: 1px solid var(--border);
}

.history-slot {
  display: flex;
  flex: 1 1 0;
  align-items: flex-end;
  min-width: 0;
  cursor: default;
}

.history-bar {
  display: block;
  width: 100%;
  border-radius: 4px 4px 0 0;
  background: var(--accent);
  opacity: 0.75;
  transition: opacity 120ms ease;
}

.history-slot--active .history-bar {
  opacity: 1;
}

.history-slot--active {
  background: var(--bg-hover);
  border-radius: 4px 4px 0 0;
}

.history-axis {
  display: flex;
  justify-content: space-between;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
