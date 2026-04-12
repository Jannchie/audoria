<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useLyrics } from '../composables/useLyrics'
import { resolveApiUrl, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const { data: tracks } = useMusicQuery()
const {
  currentTrackId,
  isPlaying,
  currentTime,
  duration,
  shuffle,
  repeatMode,
  volume,
  muted,
  selectTrack,
  setPlaying,
  toggleShuffle,
  cycleRepeat,
  seekTo,
  setVolume,
  toggleMute,
} = usePlayerState()

const lyricsContainer = ref<HTMLDivElement | null>(null)

const currentTrack = computed(() => {
  const items = tracks.value ?? []
  if (items.length === 0) {
    return null
  }
  return items.find(item => item.id === currentTrackId.value) ?? items[0]
})

const resolvedCurrentTrackId = computed(() => currentTrack.value?.id ?? null)

const currentTrackCoverUrl = computed(() => {
  if (!currentTrack.value?.coverUrl) {
    return ''
  }
  return resolveApiUrl(currentTrack.value.coverUrl)
})

const title = computed(() => currentTrack.value?.title || currentTrack.value?.filename || 'No track selected')
const artist = computed(() => currentTrack.value?.artists || 'Unknown Artist')
const album = computed(() => currentTrack.value?.album || '')

const { parsed, isTimeSynced, plainText, currentLineIndex } = useLyrics(
  () => currentTrack.value?.lyrics,
)

const hasLyrics = computed(() => Boolean(currentTrack.value?.lyrics?.trim()))

const progress = computed(() => {
  if (!duration.value) {
    return 0
  }
  return Math.min(100, (currentTime.value / duration.value) * 100)
})

const repeatIcon = computed(() => {
  if (repeatMode.value === 'one') {
    return 'i-tabler-repeat-once'
  }
  if (repeatMode.value === 'off') {
    return 'i-tabler-repeat-off'
  }
  return 'i-tabler-repeat'
})

const volumeIcon = computed(() => {
  if (muted.value || volume.value === 0) {
    return 'i-tabler-volume-off'
  }
  if (volume.value < 0.5) {
    return 'i-tabler-volume-2'
  }
  return 'i-tabler-volume'
})

const effectiveVolume = computed(() => muted.value ? 0 : volume.value)
const volumeSliderStyle = computed(() => {
  const percent = Math.round(effectiveVolume.value * 100)
  return {
    background: `linear-gradient(to right, rgb(255, 255, 255) 0%, rgb(255, 255, 255) ${percent}%, rgba(255, 255, 255, 0.12) ${percent}%, rgba(255, 255, 255, 0.12) 100%)`,
  }
})

function formattedTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '0:00'
  }
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function handleProgressClick(event: MouseEvent): void {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  const newTime = ratio * (duration.value || 0)
  seekTo(newTime)
  const audio = document.querySelector('audio')
  if (audio) {
    audio.currentTime = newTime
  }
}

function handleLyricClick(line: { time: number }): void {
  seekTo(line.time)
  const audio = document.querySelector('audio')
  if (audio) {
    audio.currentTime = line.time
  }
  if (!isPlaying.value) {
    setPlaying(true)
  }
}

function handleVolumeInput(event: Event): void {
  const slider = event.target as HTMLInputElement
  setVolume(Number(slider.value) / 100)
}

function pickNextId(direction: 'next' | 'prev'): string | null {
  const items = tracks.value ?? []
  if (items.length === 0) {
    return null
  }
  if (shuffle.value) {
    const others = items.filter(item => item.id !== resolvedCurrentTrackId.value)
    const pool = others.length > 0 ? others : items
    return pool[Math.floor(Math.random() * pool.length)]?.id ?? null
  }
  const index = items.findIndex(item => item.id === resolvedCurrentTrackId.value)
  if (index === -1) {
    return items[0]?.id ?? null
  }
  if (direction === 'next') {
    const next = items[index + 1]
    if (next) {
      return next.id
    }
    return repeatMode.value === 'all' ? items[0]?.id ?? null : null
  }
  const prev = items[index - 1]
  if (prev) {
    return prev.id
  }
  return repeatMode.value === 'all' ? items.at(-1)?.id ?? null : null
}

function handleNext(): void {
  if (repeatMode.value === 'one') {
    const audio = document.querySelector('audio')
    if (audio) {
      audio.currentTime = 0
      audio.play().catch(() => setPlaying(false))
    }
    return
  }
  const nextId = pickNextId('next')
  if (nextId) {
    selectTrack(nextId); setPlaying(true)
  }
}

function handlePrev(): void {
  const prevId = pickNextId('prev')
  if (prevId) {
    selectTrack(prevId); setPlaying(true)
  }
}

function togglePlayPause(): void {
  const audio = document.querySelector('audio')
  if (!audio) {
    return
  }
  if (audio.paused) {
    if (!currentTrackId.value && resolvedCurrentTrackId.value) {
      selectTrack(resolvedCurrentTrackId.value)
    }
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  else {
    audio.pause()
    setPlaying(false)
  }
}

watch(currentLineIndex, async (idx) => {
  if (idx < 0) {
    return
  }
  await nextTick()
  const container = lyricsContainer.value
  if (!container) {
    return
  }
  const activeLine = container.querySelector(`[data-lyric-index="${idx}"]`) as HTMLElement | null
  if (!activeLine) {
    return
  }
  const containerRect = container.getBoundingClientRect()
  const targetScroll = activeLine.offsetTop - container.offsetTop - containerRect.height / 2 + activeLine.offsetHeight / 2
  container.scrollTo({ top: targetScroll, behavior: 'smooth' })
})
</script>

<template>
  <section class="player-page">
    <!-- Background blur -->
    <div class="bg-cover-blur">
      <div
        v-if="currentTrackCoverUrl"
        class="bg-cover-image"
        :style="{ backgroundImage: `url(${currentTrackCoverUrl})` }"
      />
      <div class="bg-cover-overlay" />
    </div>

    <div class="player-layout">
      <div class="player-main">
        <!-- Left: cover only, centered -->
        <div class="player-left">
          <div
            class="cover-art"
            :class="{ 'cover-art--playing': isPlaying }"
          >
            <img
              v-if="currentTrackCoverUrl"
              :src="currentTrackCoverUrl"
              :alt="title"
              class="h-full w-full object-cover"
            >
            <div
              v-else
              class="cover-placeholder"
            >
              <span class="i-tabler-music text-5xl text-white/15" />
            </div>
          </div>
        </div>

        <!-- Right: title + artist + lyrics -->
        <div class="player-right">
          <!-- Track info above lyrics -->
          <div class="track-info">
            <h1 class="track-title text-heading">
              {{ title }}
            </h1>
            <p class="track-artist">
              {{ artist }}
              <template v-if="album">
                · {{ album }}
              </template>
            </p>
          </div>

          <!-- Lyrics with fade edges -->
          <div class="lyrics-wrapper">
            <div
              v-if="isTimeSynced && parsed"
              ref="lyricsContainer"
              class="lyrics-scroll inner-scroll"
            >
              <div class="lyrics-pad">
                <button
                  v-for="(line, i) in parsed"
                  :key="i"
                  type="button"
                  :data-lyric-index="i"
                  class="lyric-line"
                  :class="[
                    i === currentLineIndex
                      ? 'lyric-line--active'
                      : i < currentLineIndex
                        ? 'lyric-line--past'
                        : 'lyric-line--future',
                  ]"
                  @click="handleLyricClick(line)"
                >
                  {{ line.text || '···' }}
                </button>
              </div>
            </div>

            <div
              v-else-if="hasLyrics"
              ref="lyricsContainer"
              class="lyrics-scroll inner-scroll"
            >
              <p class="lyrics-plain">
                {{ plainText }}
              </p>
            </div>

            <div
              v-else
              class="lyrics-empty"
            >
              <span class="i-tabler-music-off text-3xl text-white/10" />
              <p class="text-sm text-white/25 mt-3">
                No lyrics available
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom controls -->
      <div class="player-bottom">
        <div
          class="progress-hit"
          @click="handleProgressClick"
        >
          <div class="progress-track">
            <div
              class="progress-fill"
              :style="{ width: `${progress}%` }"
            >
              <div class="progress-thumb" />
            </div>
          </div>
        </div>
        <div class="progress-time">
          <span>{{ formattedTime(currentTime) }}</span>
          <span>{{ formattedTime(duration) }}</span>
        </div>

        <div class="controls-row">
          <div class="controls-side controls-side--left">
            <button
              type="button"
              class="ctrl-btn ctrl-btn--sm"
              :class="{ 'ctrl-btn--active': shuffle }"
              @click="toggleShuffle"
            >
              <span class="i-tabler-arrows-shuffle" />
            </button>
            <button
              type="button"
              class="ctrl-btn ctrl-btn--sm"
              :class="{ 'ctrl-btn--active': repeatMode !== 'off' }"
              @click="cycleRepeat"
            >
              <span :class="repeatIcon" />
            </button>
          </div>

          <div class="controls-center">
            <button
              type="button"
              class="ctrl-btn ctrl-btn--md"
              @click="handlePrev"
            >
              <span class="i-tabler-player-skip-back-filled" />
            </button>
            <button
              type="button"
              class="ctrl-btn-play"
              @click="togglePlayPause"
            >
              <span :class="isPlaying ? 'i-tabler-player-pause-filled' : 'i-tabler-player-play-filled'" />
            </button>
            <button
              type="button"
              class="ctrl-btn ctrl-btn--md"
              @click="handleNext"
            >
              <span class="i-tabler-player-skip-forward-filled" />
            </button>
          </div>

          <div class="controls-side controls-side--right">
            <button
              type="button"
              class="ctrl-btn ctrl-btn--sm"
              @click="toggleMute"
            >
              <span :class="volumeIcon" />
            </button>
            <input
              class="volume-slider"
              max="100"
              min="0"
              step="1"
              type="range"
              :value="muted ? 0 : Math.round(volume * 100)"
              :style="volumeSliderStyle"
              @input="handleVolumeInput"
            >
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.player-page {
  position: relative;
  height: 100vh;
}

@media (min-width: 768px) {
  .player-page {
    height: calc(100vh - 3.5rem);
  }
}

/* ---- Background ---- */
.bg-cover-blur {
  position: fixed;
  inset: 0;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
}
.bg-cover-image {
  position: absolute;
  inset: -60px;
  background-size: cover;
  background-position: center;
  filter: blur(80px) saturate(1.4) brightness(0.6);
  opacity: 0.5;
  transform: scale(1.3);
}
.bg-cover-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(14, 14, 16, 0.4) 0%,
    rgba(14, 14, 16, 0.7) 50%,
    rgba(14, 14, 16, 0.92) 100%
  );
}

/* ---- Layout ---- */
.player-layout {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.25rem;
  overflow: hidden;
  /* center horizontally with breathing room */
  max-width: 1180px;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .player-layout {
    padding: 2.5rem 3rem;
  }
}

@media (min-width: 1200px) {
  .player-layout {
    padding: 2.5rem 4rem;
  }
}

.player-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

/* ---- Mobile: horizontal compact ---- */
.player-left {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.cover-art {
  width: 80px;
  height: 80px;
  border-radius: 0.75rem;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 8px 30px -6px rgba(0, 0, 0, 0.4);
  transition: box-shadow 0.4s ease;
}
.cover-art--playing {
  box-shadow: 0 12px 40px -6px rgba(0, 0, 0, 0.55);
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--bg-elevated), var(--bg-surface));
}

/* ---- Track info (always above lyrics) ---- */
.track-info {
  flex-shrink: 0;
  text-align: center;
}

.track-title {
  font-size: 1rem;
  font-weight: 700;
  color: white;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-artist {
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 0.125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- Right panel ---- */
.player-right {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* ---- Desktop: side by side ---- */
@media (min-width: 768px) {
  .player-main {
    flex-direction: row;
    gap: 3.5rem;
    align-items: stretch;
  }

  .player-left {
    width: 40%;
    max-width: 400px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
  }

  .cover-art {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    border-radius: 1rem;
  }

  .player-right {
    flex: 1;
    gap: 0.75rem;
  }

  .track-info {
    text-align: left;
  }
  .track-title {
    font-size: 1.375rem;
  }
  .track-artist {
    font-size: 0.9375rem;
    margin-top: 0.25rem;
  }
}

@media (min-width: 1200px) {
  .player-left {
    max-width: 440px;
  }
}

/* ---- Lyrics wrapper with fade edges ---- */
.lyrics-wrapper {
  flex: 1;
  min-height: 0;
  position: relative;
  -webkit-mask-image: linear-gradient(to bottom, transparent, black 2.5rem, black calc(100% - 2.5rem), transparent);
  mask-image: linear-gradient(to bottom, transparent, black 2.5rem, black calc(100% - 2.5rem), transparent);
}

.lyrics-scroll {
  height: 100%;
  overflow-y: auto;
}

.lyrics-pad {
  padding: 2.5rem 0;
}

.lyric-line {
  display: block;
  text-align: left;
  width: 100%;
  padding: 0.3rem 0;
  cursor: pointer;
  transition: all 0.3s ease;
  border: none;
  background: none;
  font-family: inherit;
  line-height: 1.7;
}
.lyric-line--active {
  color: white;
  font-size: 1.125rem;
  font-weight: 600;
}
.lyric-line--past {
  color: rgba(255, 255, 255, 0.22);
  font-size: 0.9375rem;
}
.lyric-line--future {
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.9375rem;
}
.lyric-line:hover {
  color: rgba(255, 255, 255, 0.7);
}

.lyrics-plain {
  font-size: 0.9375rem;
  color: rgba(255, 255, 255, 0.42);
  line-height: 2;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 2.5rem 0;
}

.lyrics-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* ---- Bottom controls ---- */
.player-bottom {
  flex-shrink: 0;
  padding-top: 0.75rem;
}

.progress-hit {
  padding: 0.375rem 0;
  cursor: pointer;
}
.progress-track {
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  position: relative;
}
.progress-fill {
  height: 100%;
  border-radius: 2px;
  background: white;
  transition: none;
  position: relative;
}
.progress-thumb {
  position: absolute;
  right: -5px;
  top: -4px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.progress-hit:hover .progress-thumb { opacity: 1; }

.progress-time {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 0.125rem;
  font-variant-numeric: tabular-nums;
}

.controls-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.controls-side {
  display: none;
}

.controls-center {
  display: flex;
  align-items: center;
  gap: 1rem;
}

@media (min-width: 768px) {
  .controls-row {
    justify-content: space-between;
  }
  .controls-side {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    width: 140px;
  }
  .controls-side--right {
    justify-content: flex-end;
  }
  .controls-center {
    gap: 1.25rem;
  }
}

.ctrl-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.4);
  transition: color 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
}
.ctrl-btn:hover { color: rgba(255, 255, 255, 0.75); }
.ctrl-btn--sm { font-size: 1.125rem; }
.ctrl-btn--md { font-size: 1.5rem; color: rgba(255, 255, 255, 0.7); }
.ctrl-btn--md:hover { color: white; }
.ctrl-btn--active { color: var(--accent) !important; }

.ctrl-btn-play {
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  background: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  color: var(--bg-base);
  transition: transform 0.1s ease;
}
.ctrl-btn-play:active { transform: scale(0.95); }

.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: white;
  cursor: pointer;
  transition: background 0.15s ease;
}
.volume-slider::-webkit-slider-thumb:hover { background: white; }
.volume-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: white;
  border: none;
  cursor: pointer;
}
.volume-slider::-moz-range-track {
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}
</style>
