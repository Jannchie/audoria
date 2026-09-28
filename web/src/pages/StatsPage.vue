<script setup lang="ts">
import type { Music } from '../api/types.gen'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LazyCoverImage from '../components/LazyCoverImage.vue'
import ListeningHistoryChart from '../components/ListeningHistoryChart.vue'
import { useAuth } from '../composables/useAuth'
import { useListeningStatsQuery } from '../composables/useListeningStats'
import { resolveApiUrl, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'
import { formatListenedTime, formatRelativeTime } from '../utils/listeningFormat'

const rangeStorageKey = 'audoria.stats-range'
const ranges = [7, 30, 90, 365] as const

function readStoredRange(): number {
  try {
    const value = Number(globalThis.localStorage.getItem(rangeStorageKey))
    return (ranges as readonly number[]).includes(value) ? value : 30
  }
  catch {
    return 30
  }
}

const { t, locale } = useI18n()
const { isGuest } = useAuth()
const days = ref(readStoredRange())
watch(days, (value) => {
  try {
    globalThis.localStorage.setItem(rangeStorageKey, String(value))
  }
  catch {
    // storage unavailable
  }
})

const { data: stats, isPending, isError } = useListeningStatsQuery(days)
const { data: tracks } = useMusicQuery()
const { currentTrackId, isPlaying, selectTrack, setPlaying } = usePlayerState()

const numberFormat = computed(() => new Intl.NumberFormat(locale.value))
const hasData = computed(() => Boolean(stats.value && (stats.value.totals.playCount > 0 || stats.value.totals.listenedSeconds > 0)))

const tiles = computed(() => {
  const totals = stats.value?.totals
  if (!totals) {
    return []
  }
  return [
    { key: 'listened', label: t('stats.totals.listened'), value: formatListenedTime(totals.listenedSeconds) },
    { key: 'plays', label: t('stats.totals.plays'), value: numberFormat.value.format(totals.playCount) },
    { key: 'tracks', label: t('stats.totals.tracks'), value: `${numberFormat.value.format(totals.playedTrackCount)} / ${numberFormat.value.format(totals.trackCount)}` },
    { key: 'skips', label: t('stats.totals.skips'), value: numberFormat.value.format(totals.skipCount) },
  ]
})

function coverUrl(track: Music): string {
  const url = track.coverThumbUrl ?? track.coverUrl
  return url ? resolveApiUrl(url) : ''
}

function play(track: Music): void {
  if (currentTrackId.value === track.id) {
    setPlaying(!isPlaying.value)
    return
  }
  selectTrack(track.id, { contextTracks: tracks.value ?? [] })
  setPlaying(true)
}
</script>

<template>
  <section class="stats-page">
    <header class="stats-hero">
      <div>
        <h1 class="stats-title">
          {{ t('stats.title') }}
        </h1>
        <p
          v-if="stats"
          class="stats-subtitle"
        >
          {{ t('stats.periodSummary', { days, plays: numberFormat.format(stats.period.playCount), time: formatListenedTime(stats.period.listenedSeconds) }) }}
        </p>
      </div>
      <div
        class="stats-range"
        role="radiogroup"
        :aria-label="t('stats.range.label')"
      >
        <button
          v-for="range in ranges"
          :key="range"
          type="button"
          role="radio"
          class="stats-range-option"
          :class="{ 'stats-range-option--active': days === range }"
          :aria-checked="days === range"
          @click="days = range"
        >
          {{ t('stats.range.days', { n: range }) }}
        </button>
      </div>
    </header>

    <p
      v-if="isGuest"
      class="stats-note"
    >
      <span
        class="i-tabler-info-circle"
        aria-hidden="true"
      />
      {{ t('stats.guestNote') }}
    </p>

    <div
      v-if="isPending"
      class="stats-state"
    >
      <span
        class="i-tabler-loader-2 animate-spin"
        aria-hidden="true"
      />
    </div>

    <div
      v-else-if="isError || !stats"
      class="stats-state"
    >
      {{ t('stats.loadFailed') }}
    </div>

    <template v-else>
      <div class="stats-tiles">
        <div
          v-for="tile in tiles"
          :key="tile.key"
          class="stats-tile"
        >
          <span class="stats-tile-label">{{ tile.label }}</span>
          <span class="stats-tile-value">{{ tile.value }}</span>
        </div>
      </div>

      <div
        v-if="!hasData"
        class="stats-state"
      >
        <span
          class="i-tabler-chart-bar stats-empty-icon"
          aria-hidden="true"
        />
        <span>{{ t('stats.empty') }}</span>
      </div>

      <template v-else>
        <section class="stats-card">
          <h2 class="stats-card-title">
            {{ t('stats.history.title') }}
          </h2>
          <ListeningHistoryChart :daily="stats.daily" />
        </section>

        <div class="stats-columns">
          <section class="stats-card">
            <h2 class="stats-card-title">
              {{ t('stats.top.title') }}
            </h2>
            <p
              v-if="stats.topTracks.length === 0"
              class="stats-card-empty"
            >
              {{ t('stats.top.empty') }}
            </p>
            <ol
              v-else
              class="stats-list"
            >
              <li
                v-for="(item, index) in stats.topTracks"
                :key="item.track.id"
              >
                <button
                  type="button"
                  class="stats-row"
                  :class="{ 'stats-row--active': currentTrackId === item.track.id }"
                  @click="play(item.track)"
                >
                  <span class="stats-rank">{{ index + 1 }}</span>
                  <span class="stats-cover">
                    <LazyCoverImage
                      v-if="item.track.coverUrl"
                      :src="coverUrl(item.track)"
                      :alt="item.track.title || item.track.filename"
                      :thumbhash="item.track.coverThumbhash"
                      width="36"
                      height="36"
                    />
                    <span
                      v-else
                      class="i-tabler-music"
                      aria-hidden="true"
                    />
                  </span>
                  <span class="stats-row-text">
                    <span class="stats-row-title">{{ item.track.title || item.track.filename }}</span>
                    <span class="stats-row-sub">{{ item.track.artists || t('common.unknown') }}</span>
                  </span>
                  <span class="stats-row-meta">
                    <span class="stats-row-count">{{ t('stats.track.plays', { n: item.playCount }, item.playCount) }}</span>
                    <span class="stats-row-sub">{{ formatListenedTime(item.listenedSeconds) }}</span>
                  </span>
                </button>
              </li>
            </ol>
          </section>

          <section class="stats-card">
            <h2 class="stats-card-title">
              {{ t('stats.recent.title') }}
            </h2>
            <p
              v-if="stats.recentPlays.length === 0"
              class="stats-card-empty"
            >
              {{ t('stats.top.empty') }}
            </p>
            <ol
              v-else
              class="stats-list"
            >
              <li
                v-for="item in stats.recentPlays"
                :key="`${item.track.id}-${item.playedAt}`"
              >
                <button
                  type="button"
                  class="stats-row stats-row--recent"
                  :class="{ 'stats-row--active': currentTrackId === item.track.id }"
                  @click="play(item.track)"
                >
                  <span class="stats-cover">
                    <LazyCoverImage
                      v-if="item.track.coverUrl"
                      :src="coverUrl(item.track)"
                      :alt="item.track.title || item.track.filename"
                      :thumbhash="item.track.coverThumbhash"
                      width="36"
                      height="36"
                    />
                    <span
                      v-else
                      class="i-tabler-music"
                      aria-hidden="true"
                    />
                  </span>
                  <span class="stats-row-text">
                    <span class="stats-row-title">{{ item.track.title || item.track.filename }}</span>
                    <span class="stats-row-sub">{{ item.track.artists || t('common.unknown') }}</span>
                  </span>
                  <span class="stats-row-meta">
                    <span class="stats-row-sub">{{ formatRelativeTime(item.playedAt, locale) }}</span>
                    <span class="stats-row-sub">{{ formatListenedTime(item.listenedSeconds) }}</span>
                  </span>
                </button>
              </li>
            </ol>
          </section>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.stats-page {
  display: grid;
  gap: 1.5rem;
  padding: 1.5rem 0;
}

.stats-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
}

.stats-title {
  margin: 0;
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-display, inherit);
  letter-spacing: -0.025em;
  line-height: 1.1;
}

.stats-subtitle {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.stats-range {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--bg-surface);
}

.stats-range-option {
  padding: 0.375rem 0.875rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
  font-weight: 400;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.stats-range-option:hover {
  color: var(--text-primary);
}

.stats-range-option--active {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.stats-note {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.stats-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  color: var(--text-tertiary);
  font-size: 0.875rem;
  text-align: center;
}

.stats-empty-icon {
  font-size: 2rem;
}

.stats-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (min-width: 768px) {
  .stats-tiles {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.stats-tile {
  display: grid;
  gap: 0.375rem;
  padding: 1rem 1.125rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--bg-surface);
}

.stats-tile-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.stats-tile-value {
  font-size: 1.375rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.stats-card {
  display: grid;
  gap: 0.875rem;
  align-content: start;
  min-width: 0;
  padding: 1.125rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--bg-surface);
}

.stats-card-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
}

.stats-card-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.stats-columns {
  display: grid;
  gap: 1.5rem;
}

@media (min-width: 1024px) {
  .stats-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.stats-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.stats-row {
  display: grid;
  grid-template-columns: 1.5rem 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.375rem 0.5rem;
  border: none;
  border-radius: 0.625rem;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}

.stats-row--recent {
  grid-template-columns: 36px minmax(0, 1fr) auto;
}

.stats-row:hover {
  background: var(--bg-hover);
}

.stats-row--active .stats-row-title {
  color: var(--accent);
}

.stats-rank {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.stats-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  overflow: hidden;
  border-radius: 0.5rem;
  background: var(--bg-elevated);
  color: var(--text-tertiary);
}

.stats-cover :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.stats-row-text,
.stats-row-meta {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.stats-row-meta {
  justify-items: end;
}

.stats-row-title {
  overflow: hidden;
  font-size: 0.875rem;
  font-weight: 400;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats-row-sub {
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.stats-row-count {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
