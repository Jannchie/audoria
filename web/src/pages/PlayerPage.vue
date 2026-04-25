<script setup lang="ts">
import type { FilamentConfig } from '../components/ShaderProgressBar.vue'
import { ShaderGradient, ShaderGradientCanvas } from '@shader-gradient/vue'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import HoloCoverArt from '../components/HoloCoverArt.vue'
import MetadataEditDialog from '../components/MetadataEditDialog.vue'
import ProgressPreviewTooltip from '../components/ProgressPreviewTooltip.vue'
import ShaderProgressBar from '../components/ShaderProgressBar.vue'
import ShaderProgressControls from '../components/ShaderProgressControls.vue'
import { useCoverPalette } from '../composables/useCoverPalette'
import { findLyricLineAtTime, shiftLrcTimestamps, useLyrics } from '../composables/useLyrics'
import { resolveApiUrl, useMusicQuery, useUpdateMusic } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'
import { useSettings } from '../composables/useSettings'
import { formatTrackSpecs } from '../utils/audio'
import { getSourceDisplay } from '../utils/source'

const { data: tracks } = useMusicQuery()
const { t } = useI18n()
const { coverEffect, coverEffectEnabled, progressEffectEnabled } = useSettings()
const isDev = import.meta.env.DEV
const filamentConfig = ref<FilamentConfig>({
  gain: 2.1,
  count: 6,
  amp: 2,
  freq: 3,
  speed: 1.5,
  pulseDepth: 0.66,
  pulseFreq: 0.65,
  density: 0.55,
  smoothness: 1.8,
  converge: 0.9,
  style: 0,
})
const progressTrack = ref<HTMLDivElement | null>(null)
const volumeSlider = ref<HTMLInputElement | null>(null)
const isScrubbing = ref(false)
const isVolumeDragging = ref(false)
const isProgressHovered = ref(false)
const previewRatio = ref<number | null>(null)
const hoverPreviewTime = ref<number | null>(null)
const scrubPreviewTime = ref<number | null>(null)
const volumePreview = ref<number | null>(null)
const lyricShiftMs = ref(100)
const lyricError = ref('')
const isLyricsToolbarOpen = ref(false)
const updateLyricsMutation = useUpdateMusic()
const {
  currentTrackId,
  isPlaying,
  currentTime,
  duration,
  playMode,
  playbackContext,
  volume,
  muted,
  selectTrack,
  setPlaying,
  cyclePlayMode,
  seekTo,
  setVolume,
  toggleMute,
  getAdjacentTrackId,
  getPreviousTrackId,
} = usePlayerState()

const lyricsContainer = ref<HTMLDivElement | null>(null)

const currentTrack = computed(() => {
  const items = tracks.value ?? []
  if (items.length === 0) {
    return null
  }
  if (currentTrackId.value) {
    return items.find(item => item.id === currentTrackId.value) ?? null
  }
  const contextTrackIds = playbackContext.value?.trackIds ?? []
  for (const trackId of contextTrackIds) {
    const track = items.find(item => item.id === trackId)
    if (track) {
      return track
    }
  }
  return items[0]
})

const resolvedCurrentTrackId = computed(() => currentTrack.value?.id ?? null)

const currentTrackCoverUrl = computed(() => {
  if (!currentTrack.value?.coverUrl) {
    return ''
  }
  return resolveApiUrl(currentTrack.value.coverUrl)
})
const currentTrackForegroundMaskUrl = computed(() => {
  if (!currentTrack.value?.coverUrl) {
    return ''
  }
  return resolveApiUrl(`/music/${currentTrack.value.id}/cover/mask`)
})

const { colors: paletteColors } = useCoverPalette(currentTrackCoverUrl)

const canvasProps = {
  pixelDensity: 1.5,
  fov: 45,
  preserveDrawingBuffer: false,
} as const

const gradientProps = computed(() => ({
  preset: 'deepOcean' as const,
  type: 'sphere' as const,
  animate: 'on' as const,
  uTime: 0,
  uSpeed: 0.15,
  uStrength: 1.8,
  uDensity: 0.9,
  uFrequency: 4,
  uAmplitude: 2.5,
  range: false,
  rangeStart: 0,
  rangeEnd: 40,
  loop: false,
  loopDuration: 8,
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 120,
  color1: paletteColors.value[0],
  color2: paletteColors.value[1],
  color3: paletteColors.value[2],
  reflection: 0.4,
  wireframe: false,
  shader: 'aurora',
  cAzimuthAngle: 200,
  cPolarAngle: 110,
  cDistance: 1.8,
  cameraZoom: 13.5,
  lightType: '3d' as const,
  brightness: 1.4,
  envPreset: 'city' as const,
  grain: 'on' as const,
  grainBlending: 0.6,
  toggleAxis: false,
  smoothTime: 0.18,
  enableTransition: true,
  enableCameraControls: true,
  enableCameraUpdate: true,
}))

const title = computed(() => currentTrack.value?.title || currentTrack.value?.filename || t('player.noTrackSelected'))
const artist = computed(() => currentTrack.value?.artists || t('player.unknownArtist'))
const album = computed(() => currentTrack.value?.album || '')
const trackSpecs = computed(() => currentTrack.value ? formatTrackSpecs(currentTrack.value) : '')
const currentLyrics = computed(() => currentTrack.value?.lyrics)
const isSavingLyrics = computed(() => updateLyricsMutation.isPending.value)

const { parsed, isTimeSynced, plainText, currentLineIndex } = useLyrics(() => currentLyrics.value)

const hasLyrics = computed(() => Boolean(currentLyrics.value?.trim()))

const progress = computed(() => {
  if (isScrubbing.value && scrubPreviewTime.value !== null && duration.value) {
    return Math.min(100, (scrubPreviewTime.value / duration.value) * 100)
  }
  if (!duration.value) {
    return 0
  }
  return Math.min(100, (currentTime.value / duration.value) * 100)
})

const playModeIcon = computed(() => {
  if (playMode.value === 'sequence') {
    return 'i-tabler-list'
  }
  if (playMode.value === 'repeat-all') {
    return 'i-tabler-repeat'
  }
  if (playMode.value === 'repeat-one') {
    return 'i-tabler-repeat-once'
  }
  return 'i-tabler-arrows-shuffle'
})

const playModeLabel = computed(() => {
  let mode: string
  switch (playMode.value) {
    case 'sequence': {
      mode = t('player.playModes.sequence')
      break
    }
    case 'repeat-all': {
      mode = t('player.playModes.repeatAll')
      break
    }
    case 'repeat-one': {
      mode = t('player.playModes.repeatOne')
      break
    }
    default: {
      mode = t('player.playModes.shuffle')
    }
  }
  return t('player.playModeLabel', { mode })
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

const displayedCurrentTime = computed(() => {
  if (isScrubbing.value && scrubPreviewTime.value !== null) {
    return scrubPreviewTime.value
  }
  return currentTime.value
})
const previewTooltipVisible = computed(() =>
  previewRatio.value !== null
  && (hoverPreviewTime.value !== null || scrubPreviewTime.value !== null)
  && (isScrubbing.value || isProgressHovered.value),
)
const previewTooltipLyric = computed(() => {
  const previewTime = isScrubbing.value
    ? scrubPreviewTime.value
    : hoverPreviewTime.value
  const line = findLyricLineAtTime(parsed.value, previewTime ?? currentTime.value)
  return line?.text || t('player.noSyncedLyric')
})
const previewTooltipTimeLabel = computed(() => {
  const previewTime = isScrubbing.value
    ? scrubPreviewTime.value
    : hoverPreviewTime.value
  return formattedTime(previewTime ?? currentTime.value)
})
const effectiveVolume = computed(() => {
  if (volumePreview.value !== null) {
    return volumePreview.value
  }
  return muted.value ? 0 : volume.value
})
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

function getAudioElement(): HTMLAudioElement | null {
  return document.querySelector('audio')
}

function ratioFromPointer(event: PointerEvent | MouseEvent): number {
  const track = progressTrack.value
  if (!track) {
    return 0
  }
  const rect = track.getBoundingClientRect()
  if (rect.width === 0) {
    return 0
  }
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
}

function setPreviewByRatio(ratio: number): void {
  const total = duration.value || getAudioElement()?.duration || 0
  if (!total) {
    previewRatio.value = null
    return
  }
  const clamped = Math.min(1, Math.max(0, ratio))
  previewRatio.value = clamped
  const previewTime = clamped * total
  if (isScrubbing.value) {
    scrubPreviewTime.value = previewTime
    hoverPreviewTime.value = null
  }
  else {
    hoverPreviewTime.value = previewTime
  }
}

function clearProgressPreview(): void {
  if (isScrubbing.value) {
    return
  }
  isProgressHovered.value = false
  previewRatio.value = null
  hoverPreviewTime.value = null
}

function isPointerWithinTrack(event: PointerEvent): boolean {
  const track = progressTrack.value
  if (!track) {
    return false
  }
  const rect = track.getBoundingClientRect()
  return event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom
}

function commitSeekByRatio(ratio: number): void {
  const total = duration.value || getAudioElement()?.duration || 0
  const newTime = Math.min(1, Math.max(0, ratio)) * total
  seekTo(newTime)
  scrubPreviewTime.value = null
  const audio = getAudioElement()
  if (audio) {
    audio.currentTime = newTime
  }
}

function handleProgressKeydown(event: KeyboardEvent): void {
  const total = duration.value || getAudioElement()?.duration || 0
  if (!total) {
    return
  }
  const step = event.shiftKey ? 10 : 5
  let next: number | null = null
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowDown': { next = currentTime.value - step; break
    }
    case 'ArrowRight':
    case 'ArrowUp': { next = currentTime.value + step; break
    }
    case 'Home': { next = 0; break
    }
    case 'End': { next = total; break
    }
    default: { return
    }
  }
  event.preventDefault()
  commitSeekByRatio(Math.min(1, Math.max(0, next / total)))
}

function handleProgressPointerDown(event: PointerEvent): void {
  isScrubbing.value = true
  isProgressHovered.value = true
  setPreviewByRatio(ratioFromPointer(event))
  globalThis.addEventListener('pointermove', handleProgressPointerMove)
  globalThis.addEventListener('pointerup', handleProgressPointerUp)
  globalThis.addEventListener('pointercancel', handleProgressPointerUp)
}

function handleProgressPointerMove(event: PointerEvent): void {
  if (!isScrubbing.value) {
    return
  }
  setPreviewByRatio(ratioFromPointer(event))
}

function handleProgressPointerUp(event: PointerEvent): void {
  if (!isScrubbing.value) {
    return
  }
  commitSeekByRatio(ratioFromPointer(event))
  isScrubbing.value = false
  if (isPointerWithinTrack(event)) {
    isProgressHovered.value = true
    hoverPreviewTime.value = null
    setPreviewByRatio(ratioFromPointer(event))
  }
  else {
    clearProgressPreview()
  }
  globalThis.removeEventListener('pointermove', handleProgressPointerMove)
  globalThis.removeEventListener('pointerup', handleProgressPointerUp)
  globalThis.removeEventListener('pointercancel', handleProgressPointerUp)
}

function handleProgressPointerEnter(event: PointerEvent): void {
  isProgressHovered.value = true
  setPreviewByRatio(ratioFromPointer(event))
}

function handleProgressHoverMove(event: PointerEvent): void {
  if (isScrubbing.value) {
    return
  }
  isProgressHovered.value = true
  setPreviewByRatio(ratioFromPointer(event))
}

const isEditOpen = ref(false)
function openEdit(): void {
  if (!currentTrack.value) {
    return
  }
  isEditOpen.value = true
}
function closeEdit(): void {
  isEditOpen.value = false
}

function toggleLyricsToolbar(): void {
  isLyricsToolbarOpen.value = !isLyricsToolbarOpen.value
}

function handleLyricClick(line: { time: number }): void {
  seekTo(line.time)
  const audio = getAudioElement()
  if (audio) {
    audio.currentTime = line.time
  }
  if (!isPlaying.value) {
    setPlaying(true)
  }
}

function handleLyricShiftInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const nextShift = Number(input.value)
  if (!Number.isFinite(nextShift)) {
    return
  }
  lyricShiftMs.value = Math.max(1, Math.round(Math.abs(nextShift)))
}

async function shiftCurrentLyrics(direction: -1 | 1): Promise<void> {
  const track = currentTrack.value
  const rawLyrics = currentLyrics.value
  if (!track || !rawLyrics || isSavingLyrics.value) {
    return
  }
  const deltaMs = direction * lyricShiftMs.value
  const shiftedLyrics = shiftLrcTimestamps(rawLyrics, deltaMs)
  if (shiftedLyrics === rawLyrics) {
    return
  }
  lyricError.value = ''
  try {
    await updateLyricsMutation.mutateAsync({
      id: track.id,
      patch: { lyrics: shiftedLyrics },
    })
  }
  catch (error) {
    lyricError.value = error instanceof Error ? error.message : t('player.lyrics.saveFailed')
  }
}

function handleVolumeInput(event: Event): void {
  const slider = event.target as HTMLInputElement
  const nextVolume = Number(slider.value) / 100
  if (isVolumeDragging.value) {
    volumePreview.value = nextVolume
    return
  }
  setVolume(nextVolume)
}

function handleVolumePointerDown(): void {
  isVolumeDragging.value = true
}

function handleVolumeCommit(event?: Event): void {
  const slider = event?.target instanceof HTMLInputElement
    ? event.target
    : volumeSlider.value
  if (!slider) {
    return
  }
  setVolume(Number(slider.value) / 100)
  volumePreview.value = null
  isVolumeDragging.value = false
}

function handleNext(): void {
  const nextId = getAdjacentTrackId(tracks.value ?? [], 'next')
  if (nextId) {
    selectTrack(nextId, { contextTracks: tracks.value ?? [] })
    setPlaying(true)
  }
}

function handlePrev(): void {
  const prevId = getPreviousTrackId(tracks.value ?? [])
  if (prevId) {
    selectTrack(prevId, { contextTracks: tracks.value ?? [], history: 'skip' })
    setPlaying(true)
  }
}

function togglePlayPause(): void {
  const audio = getAudioElement()
  if (!audio) {
    return
  }
  if (audio.paused) {
    if (!currentTrackId.value && resolvedCurrentTrackId.value) {
      selectTrack(resolvedCurrentTrackId.value, { contextTracks: tracks.value ?? [] })
    }
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  else {
    audio.pause()
    setPlaying(false)
  }
}

const lyricTick = ref(0)
watch(currentLineIndex, async (idx, prev) => {
  if (idx >= 0 && idx !== prev) {
    lyricTick.value += 1
  }
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

watch([resolvedCurrentTrackId, isTimeSynced], () => {
  lyricError.value = ''
  isLyricsToolbarOpen.value = false
})

onUnmounted(() => {
  globalThis.removeEventListener('pointermove', handleProgressPointerMove)
  globalThis.removeEventListener('pointerup', handleProgressPointerUp)
  globalThis.removeEventListener('pointercancel', handleProgressPointerUp)
})
</script>

<template>
  <section class="player-page">
    <!-- Animated shader gradient background -->
    <div
      class="bg-shader"
      :class="{ 'bg-shader--paused': !isPlaying }"
    >
      <ShaderGradientCanvas
        v-bind="canvasProps"
        class="shader-canvas"
        pointer-events="none"
      >
        <ShaderGradient v-bind="gradientProps" />
      </ShaderGradientCanvas>
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
          <HoloCoverArt
            class="cover-art"
            :alt="title"
            :effect="coverEffect"
            :effect-enabled="coverEffectEnabled"
            :foreground-mask-url="currentTrackForegroundMaskUrl"
            :image-url="currentTrackCoverUrl"
            :playing="isPlaying"
          />
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
            <p
              v-if="trackSpecs || currentTrack?.source"
              class="track-specs"
            >
              <span
                v-if="currentTrack?.source"
                class="track-source"
                :class="getSourceDisplay(currentTrack.source).icon"
                :title="getSourceDisplay(currentTrack.source).label"
                aria-hidden="true"
              />
              <span v-if="trackSpecs">{{ trackSpecs }}</span>
            </p>
          </div>

          <div
            v-if="currentTrack && isTimeSynced && isLyricsToolbarOpen"
            class="lyrics-toolbar"
          >
            <div
              class="lyrics-offset-control"
              :aria-label="t('player.lyrics.offsetLabel')"
            >
              <button
                type="button"
                class="lyrics-tool-btn lyrics-tool-btn--icon"
                :aria-label="t('player.lyrics.earlier')"
                :title="t('player.lyrics.earlier')"
                :disabled="isSavingLyrics"
                @click="shiftCurrentLyrics(-1)"
              >
                <span
                  class="i-tabler-minus"
                  aria-hidden="true"
                />
              </button>
              <label class="lyrics-offset-field">
                <span>{{ t('player.lyrics.shiftAmount') }}</span>
                <input
                  :value="lyricShiftMs"
                  type="number"
                  min="1"
                  step="50"
                  inputmode="numeric"
                  :aria-label="t('player.lyrics.offsetLabel')"
                  :disabled="isSavingLyrics"
                  @input="handleLyricShiftInput"
                >
                <span class="lyrics-offset-unit">ms</span>
              </label>
              <button
                type="button"
                class="lyrics-tool-btn lyrics-tool-btn--icon"
                :aria-label="t('player.lyrics.later')"
                :title="t('player.lyrics.later')"
                :disabled="isSavingLyrics"
                @click="shiftCurrentLyrics(1)"
              >
                <span
                  class="i-tabler-plus"
                  aria-hidden="true"
                />
              </button>
              <span
                v-if="isSavingLyrics"
                class="lyrics-saving"
              >
                <span
                  class="i-tabler-loader-2 animate-spin"
                  aria-hidden="true"
                />
              </span>
            </div>
          </div>

          <p
            v-if="lyricError"
            class="lyrics-error"
            role="alert"
          >
            {{ lyricError }}
          </p>

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
                  :aria-label="t('player.playFromTime', { time: formattedTime(line.time) })"
                  :aria-current="i === currentLineIndex ? 'true' : undefined"
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
                {{ t('player.noLyricsAvailable') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom controls -->
      <div class="player-bottom">
        <div
          ref="progressTrack"
          class="progress-hit"
          role="slider"
          tabindex="0"
          :aria-label="t('common.actions.seek')"
          :aria-valuemin="0"
          :aria-valuemax="Math.max(1, Math.round(duration))"
          :aria-valuenow="Math.round(displayedCurrentTime)"
          :aria-valuetext="t('player.progressValue', { current: formattedTime(displayedCurrentTime), total: formattedTime(duration) })"
          @pointerenter="handleProgressPointerEnter"
          @pointerdown.prevent="handleProgressPointerDown"
          @pointerleave="clearProgressPreview"
          @pointermove="handleProgressHoverMove"
          @keydown="handleProgressKeydown"
        >
          <ShaderProgressBar
            v-if="progressEffectEnabled"
            :progress="progress / 100"
            :colors="paletteColors"
            :playing="isPlaying"
            :scrubbing="isScrubbing"
            :hovered="isProgressHovered"
            :lyric-tick="lyricTick"
            :filament="filamentConfig"
          />
          <div
            v-else
            class="plain-progress"
            :class="{ 'plain-progress--active': isProgressHovered || isScrubbing }"
          >
            <div class="plain-progress__track" />
            <div
              class="plain-progress__fill"
              :style="{ width: `${progress}%` }"
            />
            <div
              class="plain-progress__thumb"
              :style="{ left: `${progress}%` }"
            />
          </div>
          <ProgressPreviewTooltip
            :lyric="previewTooltipLyric"
            :ratio="previewRatio"
            :time-label="previewTooltipTimeLabel"
            :track-element="progressTrack"
            :visible="previewTooltipVisible"
          />
        </div>
        <div class="progress-time">
          <span>{{ formattedTime(displayedCurrentTime) }}</span>
          <span>{{ formattedTime(duration) }}</span>
        </div>

        <div class="controls-row">
          <div class="controls-side controls-side--left">
            <button
              type="button"
              class="ctrl-btn ctrl-btn--sm"
              :class="{ 'ctrl-btn--active': playMode !== 'sequence' }"
              :aria-label="playModeLabel"
              @click="cyclePlayMode"
            >
              <span
                :class="playModeIcon"
                aria-hidden="true"
              />
            </button>
          </div>

          <div class="controls-center">
            <button
              type="button"
              class="ctrl-btn ctrl-btn--md"
              :aria-label="t('common.actions.previousTrack')"
              @click="handlePrev"
            >
              <span
                class="i-tabler-player-skip-back-filled"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="ctrl-btn-play"
              :aria-label="isPlaying ? t('common.actions.pause') : t('common.actions.play')"
              @click="togglePlayPause"
            >
              <span
                :class="isPlaying ? 'i-tabler-player-pause-filled' : 'i-tabler-player-play-filled'"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="ctrl-btn ctrl-btn--md"
              :aria-label="t('common.actions.nextTrack')"
              @click="handleNext"
            >
              <span
                class="i-tabler-player-skip-forward-filled"
                aria-hidden="true"
              />
            </button>
          </div>

          <div class="controls-side controls-side--right">
            <button
              v-if="currentTrack && isTimeSynced"
              type="button"
              class="ctrl-btn ctrl-btn--sm"
              :class="{ 'ctrl-btn--active': isLyricsToolbarOpen }"
              :aria-label="isLyricsToolbarOpen ? t('player.lyrics.hideTools') : t('player.lyrics.showTools')"
              :aria-expanded="isLyricsToolbarOpen"
              :title="isLyricsToolbarOpen ? t('player.lyrics.hideTools') : t('player.lyrics.showTools')"
              @click="toggleLyricsToolbar"
            >
              <span
                class="i-tabler-adjustments-horizontal"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="ctrl-btn ctrl-btn--sm"
              :aria-label="t('common.actions.editMetadata')"
              :disabled="!currentTrack"
              @click="openEdit"
            >
              <span
                class="i-tabler-edit"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="ctrl-btn ctrl-btn--sm"
              :aria-label="muted ? t('common.actions.unmute') : t('common.actions.mute')"
              :aria-pressed="muted"
              @click="toggleMute"
            >
              <span
                :class="volumeIcon"
                aria-hidden="true"
              />
            </button>
            <input
              ref="volumeSlider"
              class="volume-slider"
              :aria-label="t('common.actions.volume')"
              max="100"
              min="0"
              step="1"
              type="range"
              :value="Math.round(effectiveVolume * 100)"
              :style="volumeSliderStyle"
              @input="handleVolumeInput"
              @change="handleVolumeCommit"
              @pointerdown="handleVolumePointerDown"
              @pointerup="handleVolumeCommit"
            >
          </div>
        </div>
      </div>
    </div>
    <MetadataEditDialog
      :open="isEditOpen"
      :track="currentTrack"
      @close="closeEdit"
    />
    <ShaderProgressControls
      v-if="isDev"
      v-model="filamentConfig"
    />
  </section>
</template>

<style scoped>
.player-page {
  position: relative;
  height: 100vh;
  overflow: hidden;
}

@media (min-width: 768px) {
  .player-page {
    height: calc(100vh - 3.5rem);
  }
}

/* ---- Background ---- */
.bg-shader {
  position: fixed;
  inset: 0;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
  background: #0e0e10;
  animation: bg-shader-fade 700ms ease-out;
  transition: filter 1500ms ease;
}
.bg-shader--paused {
  filter: saturate(0.45) brightness(0.72);
}
.shader-canvas {
  position: absolute !important;
  inset: 0;
  width: 100%;
  height: 100%;
  animation: bg-shader-fade 900ms ease-out 120ms both;
}

@keyframes bg-shader-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.bg-cover-image {
  position: absolute;
  inset: -60px;
  background-size: cover;
  background-position: center;
  filter: blur(80px) saturate(1.4) brightness(0.6);
  opacity: 0.18;
  transform: scale(1.3);
  mix-blend-mode: soft-light;
}
.bg-cover-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(14, 14, 16, 0.25) 0%,
    rgba(14, 14, 16, 0.55) 55%,
    rgba(14, 14, 16, 0.85) 100%
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
  max-width: 80rem;
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
  aspect-ratio: 1;
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
.track-specs {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.36);
  margin-top: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
}

.track-source {
  color: rgba(255, 255, 255, 0.5);
}

.lyrics-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.lyrics-offset-control {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.lyrics-tool-btn,
.lyrics-offset-field {
  min-height: 2rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.72);
  border-radius: 0.5rem;
}

.lyrics-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0 0.7rem;
  cursor: pointer;
  font-size: 0.8125rem;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.lyrics-tool-btn:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.lyrics-tool-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.lyrics-tool-btn--icon {
  width: 2rem;
  padding: 0;
}

.lyrics-offset-field {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.55rem;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.46);
}

.lyrics-offset-field input {
  width: 4.5rem;
  border: none;
  background: transparent;
  color: white;
  font: inherit;
  text-align: right;
  font-variant-numeric: tabular-nums;
  outline: none;
}

.lyrics-offset-field input:disabled {
  cursor: not-allowed;
}

.lyrics-offset-unit {
  color: rgba(255, 255, 255, 0.32);
}

.lyrics-saving {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  color: rgba(255, 255, 255, 0.52);
}

.lyrics-error {
  flex-shrink: 0;
  text-align: center;
  font-size: 0.75rem;
  color: #fca5a5;
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
  .track-specs {
    font-size: 0.8125rem;
  }
  .lyrics-toolbar {
    justify-content: flex-start;
  }
  .lyrics-error {
    text-align: left;
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
  scrollbar-width: none;
}
.lyrics-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.lyrics-pad {
  padding: 2.5rem 0 40vh;
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

.plain-progress {
  position: relative;
  height: 6px;
  width: 100%;
  transition: height 180ms ease;
}
.plain-progress--active {
  height: 10px;
}
.plain-progress__track {
  position: absolute;
  inset: 50% 0 auto 0;
  height: 2px;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  transition: height 180ms ease;
}
.plain-progress--active .plain-progress__track {
  height: 3px;
}
.plain-progress__fill {
  position: absolute;
  top: 50%;
  left: 0;
  height: 2px;
  transform: translateY(-50%);
  background: var(--accent, #fff);
  border-radius: 999px;
  transition: height 180ms ease;
}
.plain-progress--active .plain-progress__fill {
  height: 3px;
}
.plain-progress__thumb {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 50%;
  background: var(--accent, #fff);
  transform: translateY(-50%) scale(0);
  transition: transform 180ms ease;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.35);
}
.plain-progress--active .plain-progress__thumb {
  transform: translateY(-50%) scale(1);
}

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
    width: 172px;
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
