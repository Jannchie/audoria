<script setup lang="ts">
import type { Music } from '../api/types.gen'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatListenedTime, formatRelativeTime } from '../utils/listeningFormat'

const props = defineProps<{
  track: Pick<Music, 'playCount' | 'lastPlayedAt' | 'listenedSeconds'>
}>()

const { t, locale } = useI18n()

const playCount = computed(() => props.track.playCount ?? 0)
const lastPlayed = computed(() => props.track.lastPlayedAt
  ? formatRelativeTime(props.track.lastPlayedAt, locale.value)
  : null)
const tooltip = computed(() => [
  t('stats.track.plays', { n: playCount.value }, playCount.value),
  lastPlayed.value ? t('stats.track.lastPlayed', { time: lastPlayed.value }) : null,
  t('stats.track.listened', { time: formatListenedTime(props.track.listenedSeconds ?? 0) }),
].filter(Boolean).join(' · '))
</script>

<template>
  <span
    v-if="playCount > 0"
    class="track-play-meta"
    :title="tooltip"
  >
    <span
      class="track-play-meta-icon i-jannchie-play"
      aria-hidden="true"
    />
    <span class="track-play-meta-count">{{ t('stats.track.plays', { n: playCount }, playCount) }}</span>
    <template v-if="lastPlayed">
      <span aria-hidden="true">·</span>
      <span class="track-play-meta-last">{{ lastPlayed }}</span>
    </template>
  </span>
</template>

<style scoped>
.track-play-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  min-width: 0;
  overflow: hidden;
  font-size: 0.6875rem;
  line-height: 1.3;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.track-play-meta-icon {
  flex-shrink: 0;
  font-size: 0.75em;
}

.track-play-meta-count {
  font-variant-numeric: tabular-nums;
}

.track-play-meta-last {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
